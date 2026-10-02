/**
 * Canli mac rolesi.
 *
 *   POST /api/live  — masaustu istemcisi (Electron) GSI durumunu buraya iter.
 *                     Cihaz anahtari ya da Steam oturumuyla korunur
 *                     (bkz. _lib/identity.mjs).
 *   GET  /api/live  — site ziyaretcileri (arkadaslar) canli maci buradan okur.
 *                     `?raw=1&matchId=..&exclude=..` masaustu uygulamasina
 *                     ayni macin diger yayincilarini ham olarak verir.
 *                     Yanit ONLINE LISTESINI de tasir ve giris yapmis
 *                     izleyicinin istegi "buradayim" sayilir; site ayrica
 *                     presence istegi atmaz (bkz. _lib/presence.mjs).
 *
 * Oyun icinden gelen GSI verisi yalnizca oyuncunun kendi bilgisayarinda
 * bulunur; bu uc onu tek bir yerde toplayip herkese acar.
 */

import {
  buildLiveMatchContext,
  isLiveMatchActive,
  mergeLiveStateGroup,
  mergeLiveStatesByMatch,
  normalizeGsiPayload,
  selectLiveStateForViewer,
} from "@dotastat/core";
import { getCachedLiveInputs } from "./_lib/player-data.mjs";
import { liveStore } from "./_lib/store.mjs";
import { readSession } from "./_lib/session.mjs";
import { IDENTITY_MESSAGES, readIdentity } from "./_lib/identity.mjs";
import { readHeroPlans } from "./_lib/hero-plans.mjs";
import { fail, json } from "./_lib/respond.mjs";
import { loadRoster } from "./_lib/roster.mjs";
import { readOnline, touchPresence } from "./_lib/presence.mjs";

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
  // Yetkilendirme uc yoldan olabilir:
  //
  //   1. CIHAZ ANAHTARI ya da STEAM OTURUMU (bkz. _lib/identity.mjs) —
  //      kimlik dogrulanmis gelir: kimse baskasi adina veri gonderemez ve
  //      kimseyle paylasilan bir sir dolasmaz. Masaustu uygulamasi giris
  //      yapilmadan cihaz anahtariyla gonderir.
  //
  //   2. PAYLASILAN TOKEN (eski yol) — geriye donuk uyum icin duruyor.
  //      Guncellemeyi geciktiren kurulumlar kirilmasin diye kabul ediliyor.
  //      Token'i bilen herkes istedigi SteamID adina veri gonderebilir, bu
  //      yuzden yeni kurulumlarda kullanilmamali.
  const { identity, error } = await readIdentity(request);
  const expected = String(process.env.LIVE_INGEST_TOKEN || "").trim();
  const provided = String(request.headers.get("x-dotastat-token") || "").trim();
  const tokenOk = Boolean(expected) && provided === expected;

  if (!identity && !tokenOk) {
    return fail(error === "kimlik-yok" ? "yetkisiz" : error, {
      status: 401,
      message: IDENTITY_MESSAGES[error] || IDENTITY_MESSAGES["kimlik-yok"],
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

  // Kimlik varsa yukleyici ondan alinir; govdeye guvenilmez. Boylece biri
  // baskasinin macini kendi adina yayinlayamaz.
  const uploader = identity
    ? identity.steamId
    : String(body?.uploaderSteamId || state.localSteamId || "").trim() ||
      "anonim";

  const record = {
    ...state,
    uploaderSteamId: uploader,
    updatedAt: new Date().toISOString(),
  };

  // Biten mac (POST_GAME) ya da ana menu kaydi saklanmaz, SILINIR: GET zaten
  // onu canli saymiyor ve kayit durdukca her yoklama onu okumak zorunda
  // kaliyordu. Masaustu mac bitince bunu hemen gonderir; panel bir sonraki
  // yoklamada "canli mac yok"a duser.
  if (isLiveMatchActive(record)) {
    await liveStore().set("state:" + uploader, record, { ttlMs: LIVE_TTL_MS });
  } else {
    await liveStore().remove("state:" + uploader);
  }

  return json({ ok: true, uploader, matchId: record.matchId || "" });
}

/**
 * Ortak hero katalogunun surec ici hafizasi.
 *
 * Panel 5 saniyede bir yokluyor; her yoklamada depoya gitmek, kredi icin
 * kistigimiz Blobs okumasini geri getirirdi (bkz. _lib/player-data.mjs'teki
 * ayni gerekce). Katalog nadiren degisir; degistiginde arayuz bir sonraki
 * yoklamayi "taze" isaretleyip hafizayi atlar.
 *
 * @type {{ at: number, plans: Record<string, any> }|null}
 */
let heroPlanMemo = null;
const HERO_PLAN_MEMO_MS = 60 * 1000;

/**
 * @param {{ fresh?: boolean }} [options]  hafizayi atlar
 * @returns {Promise<Record<string, any>>}
 */
async function cachedHeroPlans(options = {}) {
  if (
    !options.fresh &&
    heroPlanMemo &&
    Date.now() - heroPlanMemo.at < HERO_PLAN_MEMO_MS
  ) {
    return heroPlanMemo.plans;
  }
  const plans = await readHeroPlans();
  heroPlanMemo = { at: Date.now(), plans };
  return plans;
}

/**
 * Hesaplanmis canli mac baglaminin surec ici hafizasi.
 *
 * Baglam (draft tavsiyesi, 10 oyuncunun item tavsiyesi, takim analizi) her
 * yoklamada bastan hesaplaniyordu; oysa masaustu en fazla birkac saniyede bir
 * yeni durum gonderiyor ve ayni izleyicinin arka arkaya iki yoklamasi cogu
 * zaman AYNI girdiyi goruyor. Anahtar, girdiyi belirleyen her seyi kapsar:
 * kayitlarin guncellenme anlari, izleyici ve katalog/istatistik hafizalarinin
 * kendisi (onlar yenilenince nesne de degisir).
 */
const CONTEXT_MEMO_LIMIT = 16;
/** @type {Map<string, { inputs: unknown[], context: Record<string, any> }>} */
const contextMemo = new Map();

/**
 * @param {string} key
 * @param {unknown[]} inputs Kimlikle karsilastirilan girdiler
 * @param {() => Record<string, any>} build
 */
function memoContext(key, inputs, build) {
  const hit = contextMemo.get(key);
  if (hit && hit.inputs.every((value, index) => value === inputs[index])) {
    return hit.context;
  }
  const context = build();
  contextMemo.delete(key);
  contextMemo.set(key, { inputs, context });
  if (contextMemo.size > CONTEXT_MEMO_LIMIT) {
    contextMemo.delete(contextMemo.keys().next().value);
  }
  return context;
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
  // Biten mac (POST_GAME, ana menu) kaydi da taze gelir ama canli sayilmaz;
  // sayilsaydi panel mac bittikten sonra kapanmiyordu.
  return rows.filter((row) => row && isLiveMatchActive(row));
}

/**
 * Izleyiciyi online isaretler ve online listesini dondurur.
 *
 * @param {Record<string, any>|null} session
 * @param {boolean} hello Sayfanin ilk istegi (kisitlama atlanir)
 * @returns {Promise<Array<Record<string, any>>|null>} okunamazsa null
 */
async function presenceForViewer(session, hello) {
  try {
    if (session) {
      await touchPresence(session, { force: hello });
    }
    return await readOnline({ fresh: hello });
  } catch {
    return null;
  }
}

export default async (request) => {
  // Kadro degisiklik katmani (gizlenen / eklenen oyuncular).
  await loadRoster();
  if (request.method === "POST") {
    return ingest(request);
  }

  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const viewerSteamId = url.searchParams.get("steamId") || "";

    // `readSession` yalnizca cerez cozer, depoya gitmez.
    const viewerSession = readSession(request);

    const states = await readFreshStates();

    // MASAUSTU ICIN HAM VERI: `?raw=1&matchId=...&exclude=<steamId>`.
    // Masaustu uygulamasi kendi macinin DIGER yayincilarini (takim
    // arkadaslarinin envanteri, Overwolf'lu birinin 10 slotu) buradan ceker
    // ve kendi GSI verisiyle birlestirir (bkz. core mergeRemoteLiveState).
    // Istekte bulunanin kendi kaydi ayiklanir: birkac saniyelik eski kopyasi
    // yereldeki taze veriyi ezmesin. Tavsiye hesaplanmaz; o is masaustunde.
    if (url.searchParams.get("raw") === "1") {
      const matchId = String(url.searchParams.get("matchId") || "").trim();
      const exclude = String(url.searchParams.get("exclude") || "").trim();
      if (!matchId) {
        return fail("mac-kimligi-yok", { status: 400 });
      }
      const others = states.filter(
        (row) =>
          String(row.matchId || "").trim() === matchId &&
          (!exclude || String(row.uploaderSteamId || "") !== exclude),
      );
      const state = mergeLiveStateGroup(others);
      return json(
        { ok: true, active: Boolean(state), state: state || null },
        { cacheSeconds: 2 },
      );
    }

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

    // Tavsiye katalogu ORTAKTIR: kadrodaki herkes ayni kaydi duzenler ve
    // masaustu uygulamasi da ayni kaydi okur (bkz. _lib/hero-plans.mjs). Bu
    // yuzden tavsiye izleyiciye gore DEGISMEZ; giris yapmamis bir ziyaretci de
    // grubun duzenledigi hali gorur.
    //
    // Yanit oturuma gore onbelleklenir: `canEditItemPlans` kisiye ozeldir.
    //
    // ONLINE LISTESI: giris yapmis izleyicinin bu yoklamasi heartbeat yerine
    // gecer (yazma kisitli, bkz. touchPresence). `hello=1` sayfanin ilk
    // istegidir; yeniden yukleme sonrasi kullanici listede hemen gorunsun.
    // Liste okunamazsa canli mac yine doner; arayuz onceki listeyi korur.
    const online = await presenceForViewer(
      viewerSession,
      url.searchParams.get("hello") === "1",
    );

    if (!liveState) {
      return json(
        { ok: true, active: false, reason: "canli-mac-yok", online },
        { cacheSeconds: viewerSession ? 0 : CACHE_SECONDS_IDLE },
      );
    }

    // Katalog yalnizca ORTADA MAC VARKEN okunur ve kisa sureli hafizadan
    // gelir: aksi halde her izleyici, her 5 saniyede bir fazladan Blobs
    // okumasi ekleyecekti.
    const heroOverrides = await cachedHeroPlans({
      // Kullanici az once kaydettiyse arayuz bunu isaretler ve hafiza
      // atlanir; aksi halde degisiklik bir dakika gorunmezdi.
      fresh: url.searchParams.get("plans") === "fresh",
    });

    const { statsByPlayerId, profilesByPlayerId } = await getCachedLiveInputs();
    const statesKey = states
      .map((row) => row.uploaderSteamId + "@" + row.updatedAt)
      .join(",");
    const context = memoContext(
      viewerSteamId + "|" + statesKey,
      [heroOverrides, statsByPlayerId, profilesByPlayerId],
      () =>
        buildLiveMatchContext({
          liveState,
          statsByPlayerId,
          profilesByPlayerId,
          viewerSteamId,
          heroOverrides,
        }),
    );

    return json(
      {
        ok: true,
        ...context,
        // Arayuz "Tavsiyeleri yonet" butonunu buna bakarak acar.
        canEditItemPlans: Boolean(viewerSession),
        // Ayni anda baska maclar da varsa arayuz bunu belirtebilsin.
        liveMatchCount: merged.length,
        online,
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
