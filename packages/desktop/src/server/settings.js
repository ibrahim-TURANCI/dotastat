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
 *   - useOverwolf    : Overwolf/DotaPlus loglarindan canli draft okunsun mu
 *   - startMinimized : acilista pencere gosterilmesin, tepside kalsin
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

/**
 * Ayar dosyasinin sema surumu.
 *
 * 2: "Acilista simge durumunda baslat" varsayilani ACIK oldu.
 *
 *    Yalnizca DEFAULTS'u degistirmek yetmez: `write` her seferinde TUM
 *    anahtarlari diske yaziyor ve dosya, kullanici ayarlara hic girmese bile
 *    olusuyor (GSI ilk maci gorunce `detectedSteamId` yaziliyor). Yani
 *    mevcut kurulumlarda `startMinimized: false` zaten dosyada duruyor ve
 *    varsayilan degisiminden etkilenmezdi. Surum atlamasi bu ayari bir KEZ
 *    acar; sonradan kapatan kullanicinin tercihi korunur, cunku kapatma
 *    islemi guncel surumu de dosyaya yazar.
 */
const SETTINGS_VERSION = 2;

const DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  steamId: "",
  detectedSteamId: "",
  cloudUrl: "",
  ingestToken: "",
  openDotaApiKey: "",
  stratzApiKey: "",
  shareLive: true,
  // Overwolf kurulu degilse zaten hicbir sey okunmaz; kurulu olanda ek
  // veriden vazgecmek icin sebep yok, bu yuzden varsayilan aciktir.
  useOverwolf: true,
  // Uygulama bir tepsi uygulamasi: pencere kapatilinca da arka planda
  // calismaya devam ediyor. Acilista pencereyi one atmasi icin sebep yok,
  // isini sessizce yapsin. Tepsi menusundeki "Ac" her zaman geri getirir.
  startMinimized: true,
  autoInstallGsi: true,
};

/**
 * Eski surumle yazilmis ayar dosyasini bugunku varsayilanlara tasir.
 *
 * @param {Record<string, any>} stored Diskten okunan ham ayar
 * @returns {{ settings: Record<string, any>, changed: boolean }}
 */
function migrateSettings(stored) {
  const version = Number(stored?.settingsVersion) || 1;
  if (version >= SETTINGS_VERSION) {
    return { settings: stored, changed: false };
  }
  return {
    settings: {
      ...stored,
      startMinimized: true,
      settingsVersion: SETTINGS_VERSION,
    },
    changed: true,
  };
}

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
    // Dosya YOKSA goc calistirilmaz: yeni kurulumda DEFAULTS zaten guncel
    // surumu tasiyor ve bos yere dosya yazmanin anlami olmaz.
    let hadFile = false;
    try {
      stored = JSON.parse(fs.readFileSync(filePath, "utf8")) || {};
      hadFile = true;
    } catch {
      stored = {};
    }

    const migration = hadFile
      ? migrateSettings(stored)
      : { settings: stored, changed: false };

    // Ortam degiskenleri ayar dosyasindan once gelir (CI / gelistirme icin).
    cache = {
      ...DEFAULTS,
      ...migration.settings,
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

    // Goc diske de yazilir; aksi halde her acilista yeniden uygulanir ve
    // kullanicinin sonradan kapattigi ayar geri acilirdi. Yazamamak (salt
    // okunur klasor, disk dolu) baslangici durdurmaz: bellekteki deger
    // gecerlidir, goc bir sonraki acilista yeniden denenir.
    if (migration.changed) {
      try {
        persist(cache);
      } catch {
        // Sessizce gecilir; ayarlar bu oturumda yine de dogru calisir.
      }
    }

    return cache;
  }

  /**
   * @param {Record<string, any>} next
   */
  function persist(next) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  }

  function write(patch) {
    const next = { ...read(), ...(patch || {}) };
    cache = next;
    persist(next);
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
