/**
 * Siteye ait Steam oturum cerezinin Electron tarafindaki karsiligi.
 *
 * NEDEN VAR: canli mac verisini siteye gonderirken kimlik dogrulamak icin
 * eskiden 9 kisiye ayni gizli anahtar (`LIVE_INGEST_TOKEN`) dagitiliyordu.
 * Anahtari bilen herkes istedigi SteamID adina veri gonderebiliyordu ve her
 * arkadasin ayarlara elle bir sir yapistirmasi gerekiyordu.
 *
 * Bunun yerine kullanici masaustu uygulamasindan siteye Steam ile giris
 * yapiyor; cerez Electron'un oturumunda duruyor ve role isteklerine ekleniyor.
 * Kimlik imzali geldigi icin kimse baskasi adina veri gonderemez.
 *
 * Cerez omru 30 gundur (bkz. netlify/functions/_lib/session.mjs), yani
 * kullanici ayda bir kez giris yapar.
 *
 * CIHAZ ANAHTARI (varsayilan yol): Steam girisi artik ZORUNLU DEGIL. Steam,
 * IP'si telefondaki Steam uygulamasindan farkli sehirde gorunen girisleri
 * engelliyor ve bazi arkadaslar hic giris yapamiyordu. Uygulama kullaniciyi
 * zaten oyundan (GSI) taniyor; her istege o SteamID ile bu kuruluma ozel
 * rastgele bir anahtar eklenir. Site anahtari hesaba ilk kullanimda baglar
 * (bkz. netlify/functions/_lib/identity.mjs). Oturum varsa o da gider; ikisi
 * birlikte gelince site bu cihazi hesaba ekler (ikinci bilgisayar icin).
 */

/** Sitenin oturum cerezinin adi. */
const SESSION_COOKIE = "dotastat_session";

/** Sitenin bekledigi cihaz basliklari. */
const DEVICE_KEY_HEADER = "x-dotastat-device";
const DEVICE_STEAM_HEADER = "x-dotastat-steam";

/**
 * Cihaz kimligini veren fonksiyon (bkz. server/index.js). Ayarlara bagli
 * oldugu icin acilista baglanir.
 *
 * @type {() => ({ steamId: string, key: string }|null)}
 */
let deviceIdentity = () => null;

/** Sitenin son yaniti kimligi reddetti mi (401)? Arayuzde gosterilir. */
let lastAuthRejected = false;

/**
 * @param {() => ({ steamId: string, key: string }|null)} getter
 */
function configureDeviceIdentity(getter) {
  deviceIdentity = typeof getter === "function" ? getter : () => null;
}

/**
 * Cihaz basliklari; SteamID henuz bilinmiyorsa (oyun hic acilmadi) bos.
 * @returns {Record<string, string>}
 */
function deviceHeaders() {
  let identity = null;
  try {
    identity = deviceIdentity();
  } catch {
    identity = null;
  }
  const steamId = String(identity?.steamId || "");
  const key = String(identity?.key || "");
  if (!/^\d{17}$/.test(steamId) || !key) {
    return {};
  }
  return { [DEVICE_KEY_HEADER]: key, [DEVICE_STEAM_HEADER]: steamId };
}

/**
 * Siteye kimlikli istek atilabilir mi? Cihaz kimligi ya da site oturumu.
 * @param {string} cloudUrl
 * @returns {Promise<boolean>}
 */
async function canAuthenticate(cloudUrl) {
  if (!cloudUrl) {
    return false;
  }
  return (
    Object.keys(deviceHeaders()).length > 0 || (await hasCloudSession(cloudUrl))
  );
}

/** Arayuz icin: kimlik var mi, site son istekte reddetti mi. */
function cloudAuthState() {
  return {
    deviceReady: Object.keys(deviceHeaders()).length > 0,
    rejected: lastAuthRejected,
  };
}

/**
 * Electron modulunu güvenle yukler.
 *
 * Sunucu Electron olmadan da calisabiliyor (`npm run desktop:serve`); o
 * durumda cerez deposu yoktur ve null doner.
 *
 * @returns {typeof import("electron")|null}
 */
function loadElectron() {
  try {
    // eslint-disable-next-line global-require
    const electron = require("electron");
    return electron?.session?.defaultSession ? electron : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} cloudUrl
 * @returns {Promise<string>} `ad=deger` bicimi; oturum yoksa bos dize
 */
async function readSessionCookie(cloudUrl) {
  const electron = loadElectron();
  if (!cloudUrl || !electron) {
    return "";
  }
  try {
    const rows = await electron.session.defaultSession.cookies.get({
      url: cloudUrl,
      name: SESSION_COOKIE,
    });
    const row = rows && rows[0];
    return row ? SESSION_COOKIE + "=" + row.value : "";
  } catch {
    return "";
  }
}

/**
 * @param {string} cloudUrl
 * @returns {Promise<boolean>}
 */
async function hasCloudSession(cloudUrl) {
  return Boolean(await readSessionCookie(cloudUrl));
}

/**
 * Siteye kimlik dogrulanmis istek atar.
 *
 * NEDEN AYRI BIR YARDIMCI: Electron ana surecindeki global `fetch` Chromium'un
 * ag yiginina baglidir ve Chromium `cookie` basligini YASAKLI sayar — elle
 * kurulunca sessizce DUSURULUR. Istek cerezsiz gider, sunucu 401 doner ve
 * hicbir yerde hata gorunmez.
 *
 * Dogru yol Electron'un `net.fetch`'ini oturumla kullanmaktir: `credentials`
 * verildiginde cerezleri o oturumdan kendisi ekler.
 *
 * Electron yokken (`npm run desktop:serve`) duz `fetch` kullanilir ve cerez
 * elle eklenir; orada Chromium kisitlamasi yoktur.
 *
 * @param {string} url
 * @param {{ method?: string, body?: string, headers?: Record<string,string> }} [options]
 * @returns {Promise<Response>}
 */
async function cloudFetch(url, options = {}) {
  const electron = loadElectron();
  const init = {
    method: options.method || "GET",
    // Cihaz kimligi her istege eklenir; oturum varsa site ikisini birlikte
    // gorup bu cihazi hesaba baglar.
    headers: { ...deviceHeaders(), ...(options.headers || {}) },
    body: options.body,
    // Site erisilemezse istek asili kalmasin; oyun ici deneyim etkilenmemeli.
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 8000),
  };

  /** @param {Response} response */
  const track = (response) => {
    if (response.status === 401) {
      lastAuthRejected = true;
    } else if (response.ok && options.method && options.method !== "GET") {
      // Yalnizca kimlik isteyen yazma uclari kimligi kanitlar.
      lastAuthRejected = false;
    }
    return response;
  };

  if (electron?.net?.fetch) {
    return track(
      await electron.net.fetch(url, {
        ...init,
        // Cerezleri varsayilan oturumdan otomatik ekler.
        credentials: "include",
        session: electron.session.defaultSession,
      }),
    );
  }

  const cookie = await readSessionCookie(url);
  if (cookie) {
    init.headers.cookie = cookie;
  }
  return track(await fetch(url, init));
}

/**
 * Oturumu kapatir (cerezi siler).
 * @param {string} cloudUrl
 * @returns {Promise<boolean>}
 */
async function clearCloudSession(cloudUrl) {
  const electron = loadElectron();
  if (!cloudUrl || !electron) {
    return false;
  }
  try {
    await electron.session.defaultSession.cookies.remove(
      cloudUrl,
      SESSION_COOKIE,
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  canAuthenticate,
  cloudAuthState,
  cloudFetch,
  configureDeviceIdentity,
  SESSION_COOKIE,
  clearCloudSession,
  hasCloudSession,
  readSessionCookie,
};
