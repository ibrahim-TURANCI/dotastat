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
 */

/** Sitenin oturum cerezinin adi. */
const SESSION_COOKIE = "dotastat_session";

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
  SESSION_COOKIE,
  clearCloudSession,
  hasCloudSession,
  readSessionCookie,
};
