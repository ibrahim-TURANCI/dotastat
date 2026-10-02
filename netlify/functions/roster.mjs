/**
 * Kadro yonetimi (Debug paneli -> Onbellek tablosu).
 *
 *   GET  /api/roster -> { overrides, players, canManage }
 *   POST /api/roster -> { action: "add", accountId, name? }
 *                       { action: "edit", id, name?, accountId? }
 *                       { action: "hide" | "show" | "delete", id }
 *
 * OKUMA herkese aciktir: kadronun adlari ve account id'leri zaten
 * `/api/players` ile gorunuyor. Masaustu uygulamasi katmani buradan okuyup
 * kendi kadrosuna uygular (bkz. desktop/src/server/app.js).
 *
 * YAZMA, "Tavsiyeleri yonet" ekranindaki "Varsayilan olarak kaydet" ile ayni
 * kurala baglidir: Steam OTURUMU + `catalogAdmin`. Cihaz anahtariyla gelen
 * istek yazamaz; istek govdesindeki kimlige guvenilmez.
 */

import {
  applyRosterChange,
  createOpenDotaClient,
  getRosterOverrides,
  isCatalogAdmin,
  listAllRoster,
  toAccountId,
} from "@dotastat/core";
import { readIdentity } from "./_lib/identity.mjs";
import { loadRoster, saveRosterOverrides } from "./_lib/roster.mjs";
import { fail, json } from "./_lib/respond.mjs";

/** Arayuze giden kadro satirlari (gizliler dahil). */
function rosterRows() {
  return listAllRoster().map((player) => ({
    id: player.id,
    name: player.name,
    accountId: player.player_id,
    hidden: player.active === false,
    source: player.source,
    catalogAdmin: player.catalogAdmin,
  }));
}

/**
 * Ad girilmediyse OpenDota profil adi denenir; o da yoksa account id.
 * @param {string} accountId
 * @returns {Promise<string>}
 */
async function profileName(accountId) {
  try {
    const client = createOpenDotaClient({
      apiKey: process.env.OPENDOTA_API_KEY || "",
      timeoutMs: 5000,
    });
    const profile = await client.getPlayerProfile(accountId);
    if (profile?.name) {
      return profile.name;
    }
  } catch {
    // Profil okunamadi; yedek ada dusulur.
  }
  return "Oyuncu " + accountId;
}

export default async (request) => {
  await loadRoster({ fresh: true });

  const { identity } = await readIdentity(request).catch(() => ({
    identity: null,
  }));
  const canManage = Boolean(
    identity?.via === "session" && isCatalogAdmin(identity.accountId),
  );

  if (request.method === "GET") {
    return json({
      ok: true,
      overrides: getRosterOverrides(),
      players: rosterRows(),
      canManage,
    });
  }

  if (request.method !== "POST") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  if (!canManage) {
    return fail("yetki-yok", {
      status: identity ? 403 : 401,
      message:
        "Kadroyu yalnızca katalog yöneticisi Steam girişiyle düzenleyebilir.",
    });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const change = { ...body };
  if (change.action === "add" && !String(change.name || "").trim()) {
    const accountId = toAccountId(change.accountId);
    if (accountId) {
      change.name = await profileName(accountId);
    }
  }

  const result = applyRosterChange(getRosterOverrides(), change);
  if (!result.ok) {
    return fail(result.error, { status: 400, message: result.message });
  }

  await saveRosterOverrides(result.overrides, identity.accountId);
  return json({
    ok: true,
    overrides: result.overrides,
    players: rosterRows(),
    canManage,
  });
};
