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
 *   - autoLaunch     : Windows oturumu acilinca uygulama kendiliginden kalksin
 *   - showOverlay    : oyun sirasinda item tavsiyesi overlay'i gosterilsin
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
 *
 * 3: "Bilgisayar acilinca baslat" eklendi ve varsayilani ACIK.
 *
 *    Ayni gerekce: mevcut kurulumlarin ayar dosyasinda bu anahtar HIC yok ve
 *    yalnizca DEFAULTS'a eklemek onlari kapsardi — ama kullanici bir kez
 *    kaydettiginde `autoLaunch: false` yazilmis olurdu. Surum atlamasi ayari
 *    bir KEZ acar; sonradan kapatan kullanicinin tercihi korunur.
 */
const SETTINGS_VERSION = 3;

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
  // Uygulamanin isi canli maci izlemek; kullanicinin Dota'yi actiktan sonra
  // "once DotaStat'i acayim" demesi gerekmemeli. Oturum acilisinda sessizce
  // kalkar ve tepside bekler (bkz. services/auto-launch.js).
  autoLaunch: true,
  autoInstallGsi: true,
  // Oyun ici overlay: Dota on plandayken sag altta soluk item tavsiyesi
  // (bkz. services/overlay.js). Yeni anahtar oldugu icin goc gerekmez; dosyada
  // yoksa DEFAULTS'tan acik gelir.
  showOverlay: true,
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
      // Her iki ayar da surum atlamasinda BIR KEZ acilir. Aradaki surumden
      // gecen kurulum ikisini de gormedigi icin ikisi birden yazilir.
      startMinimized: true,
      autoLaunch: true,
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

  /**
   * Bir ayar DEGISTIGINDE haber verilecek dinleyiciler.
   *
   * Cogu ayar okundugu anda gecerli (bir sonraki istekte yeni deger kullanilir)
   * ama bazilarinin isletim sisteminde bir KARSILIGI var: "Bilgisayar acilinca
   * baslat" kutucugu, Windows'un Run kaydini yazmayi gerektiriyor. Yalnizca
   * dosyaya yazmak yetmez; kutucuk kapatilinca kayit da silinmeli.
   *
   * @type {Map<string, Array<(value: any, settings: Record<string, any>) => void>>}
   */
  const listeners = new Map();

  /**
   * @param {Record<string, any>} previous
   * @param {Record<string, any>} next
   */
  function notify(previous, next) {
    for (const [key, handlers] of listeners) {
      if (previous?.[key] === next?.[key]) {
        continue;
      }
      for (const handler of handlers) {
        // Bir dinleyicinin hatasi ayarin KAYDEDILMESINI bozmamali: deger
        // zaten diske yazildi, yan etki basarisiz olduysa o kadari kaybedilir.
        try {
          handler(next[key], next);
        } catch {
          // Sessizce gecilir.
        }
      }
    }
  }

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
    const previous = read();
    const next = { ...previous, ...(patch || {}) };
    cache = next;
    persist(next);
    notify(previous, next);
    return next;
  }

  return {
    get: () => ({ ...read() }),
    update: (patch) => ({ ...write(patch) }),
    /**
     * Bir ayarin degisimini dinler.
     *
     * Yalnizca DEGER DEGISTIGINDE cagrilir; ayarlar ekrani her kaydedisinde
     * tum anahtarlari birden gonderiyor ve her kayitta Run kaydini yeniden
     * yazmanin anlami yok.
     *
     * @param {string} key
     * @param {(value: any, settings: Record<string, any>) => void} handler
     */
    onChange(key, handler) {
      if (typeof handler !== "function") {
        return;
      }
      if (!listeners.has(key)) {
        listeners.set(key, []);
      }
      listeners.get(key).push(handler);
    },
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
