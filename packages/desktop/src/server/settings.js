/**
 * Uygulama ayarlari (kullaniciya ozel, JSON dosyasinda).
 *
 * Burada tutulanlar:
 *   - steamId        : elle girilen kimlik (bos ise GSI'dan tespit edilir)
 *   - cloudUrl       : canli mac verisinin gonderilecegi site adresi
 *   - ingestToken    : o site ile paylasilan gizli anahtar
 *   - openDotaApiKey : opsiyonel
 *   - stratzApiKey   : opsiyonel; OpenDota limitine takilinca yedek kaynak
 *   - shareLive      : canli mac yayini acik mi
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Paketleme sirasinda gomulen site adresi (bkz. scripts/prepare-build.mjs).
 *
 * Kurulumu indiren kisinin ayarlara elle adres girmesi gerekmesin diye
 * konur. Ayar dosyasinda bir deger varsa O oncelikli olur; yani kullanici
 * istedigi zaman baska bir adrese yonlendirebilir.
 */
function bakedCloudUrl() {
  try {
    // eslint-disable-next-line global-require
    return String(require("../../package.json")?.dotastat?.cloudUrl || "");
  } catch {
    return "";
  }
}

const DEFAULTS = {
  steamId: "",
  detectedSteamId: "",
  cloudUrl: "",
  ingestToken: "",
  openDotaApiKey: "",
  stratzApiKey: "",
  shareLive: true,
  startMinimized: false,
  autoInstallGsi: true,
};

/**
 * @param {string} filePath
 */
function createSettingsStore(filePath) {
  /** @type {typeof DEFAULTS|null} */
  let cache = null;

  function read() {
    if (cache) {
      return cache;
    }
    let stored = {};
    try {
      stored = JSON.parse(fs.readFileSync(filePath, "utf8")) || {};
    } catch {
      stored = {};
    }
    // Ortam degiskenleri ayar dosyasindan once gelir (CI / gelistirme icin).
    cache = {
      ...DEFAULTS,
      ...stored,
      // Oncelik: ortam degiskeni > kullanicinin ayari > pakete gomulu adres.
      cloudUrl:
        process.env.DOTASTAT_CLOUD_URL ||
        stored.cloudUrl ||
        bakedCloudUrl() ||
        "",
      ingestToken:
        process.env.DOTASTAT_INGEST_TOKEN || stored.ingestToken || "",
      openDotaApiKey:
        process.env.OPENDOTA_API_KEY || stored.openDotaApiKey || "",
      stratzApiKey: process.env.STRATZ_API_KEY || stored.stratzApiKey || "",
    };
    return cache;
  }

  function write(patch) {
    const next = { ...read(), ...(patch || {}) };
    cache = next;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  return {
    get: () => ({ ...read() }),
    update: (patch) => ({ ...write(patch) }),
    /**
     * Kullanicinin kimligi: elle girilen deger onceliklidir, yoksa oyundan
     * tespit edilen SteamID kullanilir.
     * @returns {string}
     */
    resolveSteamId() {
      const settings = read();
      const manual = String(settings.steamId || "").trim();
      if (/^\d{17}$/.test(manual)) {
        return manual;
      }
      const detected = String(settings.detectedSteamId || "").trim();
      return /^\d{17}$/.test(detected) ? detected : "";
    },
  };
}

module.exports = {
  createSettingsStore,
  DEFAULT_SETTINGS: DEFAULTS,
};
