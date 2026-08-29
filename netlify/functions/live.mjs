/**
 * Canli mac rolesi.
 *
 *   POST /api/live  — masaustu istemcisi (Electron) GSI durumunu buraya iter.
 *                     `x-dotastat-token` basligi ile korunur.
 *   GET  /api/live  — site ziyaretcileri (arkadaslar) canli maci buradan okur.
 *
 * Oyun icinden gelen GSI verisi yalnizca oyuncunun kendi bilgisayarinda
 * bulunur; bu uc onu tek bir yerde toplayip herkese acar.
 */

import {
  buildLiveMatchContext,
  isLiveMatchFresh,
  normalizeGsiPayload,
  selectLiveStateForViewer,
} from "@dotastat/core";
import { getCachedStatsByPlayerId } from "./_lib/player-data.mjs";
import { liveStore } from "./_lib/store.mjs";
import { fail, json } from "./_lib/respond.mjs";

/** Kayitlarin depoda tutulma suresi. */
const LIVE_TTL_MS = 10 * 60 * 1000;

/**
 * Masaustu istemcisinin gonderdigi durumu kaydeder.
 * @param {Request} request
 */
async function ingest(request) {
  const expected = String(process.env.LIVE_INGEST_TOKEN || "").trim();
  if (!expected) {
    return fail("ingest-kapali", {
      status: 503,
      message:
        "LIVE_INGEST_TOKEN ortam degiskeni tanimli degil; canli mac yayini kapali.",
    });
  }

  const provided = String(request.headers.get("x-dotastat-token") || "").trim();
  if (provided !== expected) {
    return fail("yetkisiz", { status: 401 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return fail("gecersiz-govde", { status: 400 });
  }

  // Istemci ister ham GSI, ister normalize edilmis durum gonderebilir.
  const state = body?.raw ? normalizeGsiPayload(body.raw) : body?.state;
  if (!state || typeof state !== "object") {
    return fail("durum-yok", { status: 400 });
  }

  const uploader =
    String(body?.uploaderSteamId || state.localSteamId || "").trim() ||
    "anonim";

  const record = {
    ...state,
    uploaderSteamId: uploader,
    updatedAt: new Date().toISOString(),
  };

  await liveStore().set("state:" + uploader, record, { ttlMs: LIVE_TTL_MS });

  return json({ ok: true, uploader, matchId: record.matchId || "" });
}

/**
 * Su an yayinda olan TUM taze canli mac kayitlari.
 *
 * Masaustu uygulamasini kuran herkes kendi macini ayri bir anahtara yazar
 * (`state:<steamId>`), bu yuzden ayni anda birden fazla mac olabilir.
 */
async function readFreshStates() {
  const store = liveStore();
  const keys = (await store.keys()).filter((key) => key.startsWith("state:"));
  const rows = await Promise.all(keys.map((key) => store.get(key)));
  return rows.filter((row) => row && isLiveMatchFresh(row));
}

export default async (request) => {
  if (request.method === "POST") {
    return ingest(request);
  }

  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const viewerSteamId = url.searchParams.get("steamId") || "";

    const states = await readFreshStates();
    // Birden fazla arkadas ayni anda ayri maclardaysa hangisinin gosterilecegi
    // izleyiciye gore secilir; yoksa panel surekli maclar arasinda zipliyordu.
    const liveState = selectLiveStateForViewer(states, { viewerSteamId });
    if (!liveState) {
      return json({ ok: true, active: false, reason: "canli-mac-yok" });
    }

    const statsByPlayerId = await getCachedStatsByPlayerId();
    const context = buildLiveMatchContext({
      liveState,
      statsByPlayerId,
      viewerSteamId,
    });

    return json({
      ok: true,
      ...context,
      // Ayni anda baska maclar da varsa arayuz bunu belirtebilsin.
      liveMatchCount: states.length,
    });
  } catch (error) {
    return fail("canli-mac-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
