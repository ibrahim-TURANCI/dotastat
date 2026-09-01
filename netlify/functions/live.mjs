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
import { readItemPlans, sessionAccountId } from "./_lib/item-plans.mjs";
import { fail, json } from "./_lib/respond.mjs";

/** Kayitlarin depoda tutulma suresi. */
const LIVE_TTL_MS = 10 * 60 * 1000;

/**
 * Yanitin CDN'de bekletilecegi sure.
 *
 * Panel bu ucu surekli yokluyor (bkz. App.jsx: mac varken 5 sn, yokken 20 sn)
 * ve her yoklama ayri bir fonksiyon cagrisi demek.
 *
 * KAZANCIN SINIRI: adres izleyicinin SteamID'sini tasidigi icin onbellek kisi
 * bazlidir. Giris yapmis iki izleyici ayni maca baksa bile farkli adres
 * kullanir ve onbellegi paylasmaz. Asil kazanc GIRIS YAPMAMIS ziyaretcilerde:
 * hepsi ayni adresi cagirir, es zamanli bakan N kisi tek cagriya toplanir.
 *
 * Sureler yoklama araliginin ALTINDA tutuldu ki tek bir izleyicinin gordugu
 * veri bir yoklama periyodundan fazla eskimesin. Bekleme halinde deger ozellikle
 * kisa: o yol zaten ucuz (fan-out yok) ve buyuk bir omur, "mac basladi"
 * bilgisini yoklama araliginin USTUNE gecikme eklerdi.
 */
const CACHE_SECONDS_ACTIVE = 4;
const CACHE_SECONDS_IDLE = 5;

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
 * Item duzenlemelerinin surec ici hafizasi.
 *
 * Panel 5 saniyede bir yokluyor; her yoklamada depoya gitmek, kredi icin
 * kistigimiz Blobs okumasini geri getirirdi (bkz. _lib/player-data.mjs'teki
 * ayni gerekce). Kullanicinin kendi duzenlemesi zaten nadiren degisir ve
 * degistiginde dialog kaydi kapatirken hafiza temizlenir.
 *
 * @type {Map<string, { at: number, plans: Record<string, any> }>}
 */
const itemPlanMemo = new Map();
const ITEM_PLAN_MEMO_MS = 60 * 1000;

/**
 * @param {string} accountId
 * @param {{ fresh?: boolean }} [options]  hafizayi atlar
 * @returns {Promise<Record<string, any>>}
 */
async function cachedItemPlans(accountId, options = {}) {
  const key = String(accountId || "");
  if (!key) {
    return {};
  }
  const hit = itemPlanMemo.get(key);
  if (!options.fresh && hit && Date.now() - hit.at < ITEM_PLAN_MEMO_MS) {
    return hit.plans;
  }
  const plans = await readItemPlans(key);
  itemPlanMemo.set(key, { at: Date.now(), plans });
  return plans;
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

    // Item tavsiyesi duzenlemeleri KISIYE OZELDIR. Oturum varsa yanit o kisiye
    // gore sekillenir, dolayisiyla CDN'de PAYLASILAMAZ; yoksa bir kullanicinin
    // duzenlemesi baskasinin ekranina dusebilir. Oturum yoksa duzenleme de yok
    // ve yanit herkes icin ayni — asil onbellek kazanci zaten orada
    // (bkz. CACHE_SECONDS_ACTIVE aciklamasi).
    //
    // `readSession` yalnizca cerez cozer, depoya gitmez; bu yuzden erken
    // donusten ONCE cagrilabilir.
    const viewerSession = readSession(request);
    if (!liveState) {
      return json(
        { ok: true, active: false, reason: "canli-mac-yok" },
        { cacheSeconds: viewerSession ? 0 : CACHE_SECONDS_IDLE },
      );
    }

    // Duzenlemeler yalnizca ORTADA MAC VARKEN okunur ve kisa sureli
    // hafizadan gelir: aksi halde giris yapmis her izleyici, her 5 saniyede
    // bir fazladan Blobs okumasi ekleyecekti.
    const overrides = viewerSession
      ? await cachedItemPlans(sessionAccountId(viewerSession), {
          // Kullanici az once kaydettiyse arayuz bunu isaretler ve hafiza
          // atlanir; aksi halde degisiklik bir dakika gorunmezdi.
          fresh: url.searchParams.get("plans") === "fresh",
        })
      : {};

    const statsByPlayerId = await getCachedStatsByPlayerId();
    const context = buildLiveMatchContext({
      liveState,
      statsByPlayerId,
      viewerSteamId,
      itemPlanOverrides: overrides,
    });

    return json(
      {
        ok: true,
        ...context,
        // Arayuz "Tavsiyeleri yonet" butonunu buna bakarak acar.
        canEditItemPlans: Boolean(viewerSession),
        // Ayni anda baska maclar da varsa arayuz bunu belirtebilsin.
        liveMatchCount: merged.length,
        // Bu macin verisi kac ayri kurulumdan besleniyor.
        contributorCount: (
          liveState.uploaders || [liveState.uploaderSteamId]
        ).filter(Boolean).length,
      },
      { cacheSeconds: viewerSession ? 0 : CACHE_SECONDS_ACTIVE },
    );
  } catch (error) {
    return fail("canli-mac-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
