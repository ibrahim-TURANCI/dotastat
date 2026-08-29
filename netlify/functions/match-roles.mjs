/**
 * Giris yapmis kullanicinin kendi maclarindaki pozisyon beyani.
 *
 *   GET  /api/me/match-roles  -> { roles: { [matchId]: "pos3" } }
 *   POST /api/me/match-roles  -> { matchId, role }  (role: "" ise kayit silinir)
 *
 * Yalnizca kendi kaydina eriselebilir: anahtar oturum cerezinden alinir.
 */

import { findRosterPlayer } from "@dotastat/core";
import {
  readMatchRoles,
  sessionAccountId,
  writeMatchRole,
} from "./_lib/match-roles.mjs";
import { readSession } from "./_lib/session.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  const session = readSession(request);
  if (!session) {
    return fail("oturum-yok", {
      status: 401,
      message: "Pozisyon secmek icin Steam ile giris yapmalisin.",
    });
  }

  const accountId = sessionAccountId(session);
  if (!accountId) {
    return fail("hesap-cozulemedi", { status: 400 });
  }

  if (request.method === "GET") {
    const roles = await readMatchRoles(accountId);
    return json({
      ok: true,
      accountId,
      rosterId: findRosterPlayer(accountId)?.id || "",
      roles,
    });
  }

  if (request.method !== "POST") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const result = await writeMatchRole(
    accountId,
    body.matchId,
    body.role === undefined ? "" : body.role,
  );

  if (!result.ok) {
    return fail(result.error || "kaydedilemedi", { status: 400 });
  }

  return json({ ok: true, accountId, roles: result.roles });
};
