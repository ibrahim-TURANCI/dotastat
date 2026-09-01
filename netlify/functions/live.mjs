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
  mergeLiveStatesByMatch,
  normalizeGsiPayload,
  selectLiveStateForViewer,
} from "@dotastat/core";
import { getCachedStatsByPlayerId } from "./_lib/player-data.mjs";
import { liveStore } from "./_lib/store.mjs";
import { readSession } from "./_lib/session.mjs";
import { fail, json } from "./_lib/respond.mjs";

/** Kayitlarin depoda tutulma suresi. */
const LIVE_TTL_MS = 10 * 60 * 1000;

/**
 * Masaustu istemcisinin gonderdigi durumu kaydeder.
 * @param {Request} request
 */
async function ingest(request) {
  // Yetkilendirme iki yoldan olabilir:
  //
  //   1. STEAM OTURUMU (tercih edilen) — masaustu uygulamasi siteye Steam ile
  //      giris yapar, cerezle gonderir. Kimlik IMZALI gelir: kimse baskasi
  //      adina veri gonderemez ve kimseyle paylasilan bir sir dolasmaz.
  //
  //   2. PAYLASILAN TOKEN (eski yol) — geriye donuk uyum icin duruyor.
  //      Guncellemeyi geciktiren kurulumlar kirilmasin diye kabul ediliyor.
  //      Token'i bilen herkes istedigi SteamID adina veri gonderebilir, bu
  //      yuzden yeni kurulumlarda kullanilmamali.
  const session = readSession(request);
  const expected = String(process.env.LIVE_INGEST_TOKEN || "").trim();
  const provided = String(request.headers.get("x-dotastat-token") || "").trim();
  const tokenOk = Boolean(expected) && provided === expected;

  if (!session && !tokenOk) {
    return fail("yetkisiz", {
      status: 401,
      message:
        "Canli mac verisi gondermek icin masaustu uygulamasindan Steam ile giris yap.",
    });
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

  // Oturum varsa yukleyici kimligi CEREZDEN alinir; govdeye guvenilmez.
  // Boylece biri baskasinin macini kendi adina yayinlayamaz.
  const uploader = session
    ? String(session.steamId || "")
    : String(body?.uploaderSteamId || state.localSteamId || "").trim() ||
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

    // AYNI MACTAKI kayitlar once tek bir tabloda birlestirilir.
    //
    // Bir macta kadrodan birkac kisi olabilir ve kurulumlari farklidir:
    // Overwolf'lu olan 10 slotun hero'sunu gorur ama kimlikler gizlidir;
    // yalnizca GSI'li olan kendi KDA'sini ve kimligini bilir. Eskiden tek bir
    // kayit secilip digerleri atiliyordu, yani her izleyici eksik bir tablo
    // goruyordu. Birlestirme ikisini de ekrana tasir.
    const merged = mergeLiveStatesByMatch(states);

    // Birden fazla arkadas ayni anda AYRI maclardaysa hangisinin gosterilecegi
    // izleyiciye gore secilir; yoksa panel surekli maclar arasinda zipliyordu.
    const liveState = selectLiveStateForViewer(merged, { viewerSteamId });
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
      liveMatchCount: merged.length,
      // Bu macin verisi kac ayri kurulumdan besleniyor.
      contributorCount: (
        liveState.uploaders || [liveState.uploaderSteamId]
      ).filter(Boolean).length,
    });
  } catch (error) {
    return fail("canli-mac-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
