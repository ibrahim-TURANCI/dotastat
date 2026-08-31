/**
 * Kalici depolama katmani (Netlify Blobs).
 *
 * Bes kova kullanilir:
 *   - `players`     : OpenDota mac onbellegi (oyuncu basina, TTL'li)
 *   - `live`        : masaustu istemcisinin gonderdigi canli mac durumu
 *   - `presence`    : online kullanicilar (heartbeat)
 *   - `match-roles` : oyuncunun elle sectigi pozisyonlar
 *   - `mmr`         : masaustunden gelen MMR okumalari
 *
 * YERELDE NEDEN AYRI BIR KOPYA VAR
 * --------------------------------
 * `netlify dev` Blobs'u taklit eden bir sunucu calistirir, ama o sunucu
 * veriyi YALNIZCA BELLEKTE tutar (`.netlify/blobs-serve` bos kalir). Dev
 * sunucusu her yeniden basladiginda — dosya degisikligi, cokme, terminali
 * kapatma — kadronun tamaminin onbellegi ucuyor: ekran doluyken bir anda
 * "9 oyuncu verisi bekleniyor"a dusuyor ve dokuz oyuncu OpenDota'dan bastan
 * cekiliyor. Gunluk limit bosa gidiyor.
 *
 * Bu yuzden YALNIZCA yerelde (`NETLIFY_DEV=true`) her yazma diske de
 * aynalanir ve Blobs bos donerse diskteki kopya okunur. Production'da bu
 * kod yolu hic calismaz; orada Blobs zaten kalicidir.
 *
 * Blobs hic kurulamazsa (CLI disinda yerel calistirma) depo tamamen diske
 * duser.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStore } from "@netlify/blobs";

/**
 * Yerel gelistirme mi?
 *
 * Dort isarete birden bakilir cunku CLI surumleri arasinda degisiyor:
 * `NETLIFY_DEV`/`NETLIFY_LOCAL` fonksiyon ortamina HER ZAMAN gecmiyor
 * (olculdu: 27.4.1'de yok), ama CLI yerel calismayi `AWS_REGION=dev` ve
 * `DEPLOY_ID=0` ile isaretliyor. Gercek bir dagitimda AWS bolgesi hicbir
 * zaman "dev" olmaz ve deploy id 0 gelmez, dolayisiyla bu kontrol
 * production'da yanlislikla acilmaz.
 */
const IS_DEV =
  String(process.env.NETLIFY_DEV || "") === "true" ||
  String(process.env.NETLIFY_LOCAL || "") === "true" ||
  String(process.env.AWS_REGION || "") === "dev" ||
  String(process.env.DEPLOY_ID || "") === "0";

/** Yerel kopyalarin yazildigi klasor. */
const LOCAL_DIR = path.join(os.tmpdir(), "dotastat-dev-store");

/** @type {Map<string, Map<string, { value: unknown, expiresAt: number }>>} */
const localStores = new Map();

/**
 * @param {string} name
 * @returns {string}
 */
function localFile(name) {
  return path.join(LOCAL_DIR, name + ".json");
}

/**
 * Kovanin yerel kopyasi (ilk erisimde diskten yuklenir).
 *
 * @param {string} name
 * @returns {Map<string, { value: unknown, expiresAt: number }>}
 */
function localStore(name) {
  if (!localStores.has(name)) {
    /** @type {Map<string, { value: unknown, expiresAt: number }>} */
    const rows = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(localFile(name), "utf8"));
      for (const [key, row] of Object.entries(raw || {})) {
        rows.set(key, row);
      }
    } catch {
      // Dosya yok ya da bozuk: bos kovayla basla.
    }
    localStores.set(name, rows);
  }
  return localStores.get(name);
}

/**
 * Kovayi diske yazar (once gecici dosya, sonra yerine tasima — yazma
 * sirasinda surec olurse dosya bozulmaz).
 *
 * Hata SESSIZCE gecilir: bu bir gelistirme kolayligi, calismazsa bellekteki
 * kopya is gormeye devam eder.
 *
 * @param {string} name
 */
function persistLocal(name) {
  try {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const file = localFile(name);
    const temporary = file + ".tmp";
    fs.writeFileSync(
      temporary,
      JSON.stringify(Object.fromEntries(localStore(name))),
      "utf8",
    );
    fs.renameSync(temporary, file);
  } catch {
    // Salt okunur dosya sistemi: bellek kopyasi yeterli.
  }
}

/**
 * Saklanan sarmaldan degeri cikarir; suresi dolmussa null doner.
 *
 * @param {{ value?: unknown, expiresAt?: number }|null} row
 * @returns {unknown|null}
 */
function unwrap(row) {
  if (!row) {
    return null;
  }
  if (row.expiresAt && Date.now() > row.expiresAt) {
    return null;
  }
  // Eski kayitlar dogrudan degerin kendisi olabilir.
  return row.value === undefined ? row : row.value;
}

/**
 * @param {string} name kova adi
 */
export function createStore(name) {
  /** @type {ReturnType<typeof getStore>|null} */
  let blobs = null;
  try {
    blobs = getStore({ name, consistency: "strong" });
  } catch {
    blobs = null;
  }

  // Blobs yoksa her sey diske; varsa yalnizca yerelde diske de aynalanir.
  const mirrorToDisk = !blobs || IS_DEV;

  /**
   * @param {string} key
   * @returns {unknown|null}
   */
  function readLocal(key) {
    const row = localStore(name).get(key);
    const value = unwrap(row);
    if (row && value === null) {
      // Suresi dolmus kaydi temizle.
      localStore(name).delete(key);
      persistLocal(name);
    }
    return value;
  }

  return {
    name,
    usingBlobs: Boolean(blobs),
    mirroringToDisk: mirrorToDisk,

    /**
     * @param {string} key
     * @returns {Promise<unknown|null>}
     */
    async get(key) {
      if (blobs) {
        try {
          const value = unwrap(await blobs.get(key, { type: "json" }));
          if (value !== null) {
            return value;
          }
        } catch {
          // Blobs okunamadi; asagidaki yerel kopyaya dusulur.
        }
        // Blobs bos dondu. Yerelde bu, dev sunucusunun yeniden baslamis
        // olmasi demek — diskteki kopya hala gecerli.
        return mirrorToDisk ? readLocal(key) : null;
      }

      return readLocal(key);
    },

    /**
     * @param {string} key
     * @param {unknown} value
     * @param {{ ttlMs?: number }} [options]
     */
    async set(key, value, options = {}) {
      const expiresAt = options.ttlMs ? Date.now() + Number(options.ttlMs) : 0;
      const row = { value, expiresAt, savedAt: Date.now() };

      if (mirrorToDisk) {
        localStore(name).set(key, row);
        persistLocal(name);
      }

      if (blobs) {
        try {
          await blobs.setJSON(key, row);
          return true;
        } catch {
          return mirrorToDisk;
        }
      }

      return true;
    },

    /**
     * @param {string} key
     */
    async remove(key) {
      if (mirrorToDisk) {
        localStore(name).delete(key);
        persistLocal(name);
      }

      if (blobs) {
        try {
          await blobs.delete(key);
          return true;
        } catch {
          return mirrorToDisk;
        }
      }

      return true;
    },

    /**
     * Kovadaki tum anahtarlari dondurur (presence ve canli mac listesi icin).
     * @returns {Promise<string[]>}
     */
    async keys() {
      /** @type {string[]} */
      let fromBlobs = [];
      if (blobs) {
        try {
          const listing = await blobs.list();
          fromBlobs = (listing?.blobs || []).map((row) => row.key);
        } catch {
          fromBlobs = [];
        }
      }

      if (!mirrorToDisk) {
        return fromBlobs;
      }
      // Iki kaynak birlesir: dev sunucusu yeniden baslamissa Blobs bos ama
      // diskte kayit duruyor olabilir.
      return [...new Set([...fromBlobs, ...localStore(name).keys()])];
    },
  };
}

export const playerStore = () => createStore("dotastat-players");
export const liveStore = () => createStore("dotastat-live");
export const presenceStore = () => createStore("dotastat-presence");
/**
 * Oyuncunun kendi maclari icin ELLE sectigi pozisyonlar.
 *
 * Anahtar: `roles:<accountId>`, deger: `{ [matchId]: "pos1".."pos5" }`.
 * TTL yoktur; bu veri kullanicinin kendi beyanidir, eskimez.
 */
export const matchRoleStore = () => createStore("dotastat-match-roles");
/**
 * Masaustu uygulamasinin ilettigi MMR okumalari.
 *
 * Anahtar: `mmr:<accountId>`. Deger oyuncunun kendi beyanidir ve oturum
 * cerezinden dogrulanir; TTL yoktur, gecmis birikir.
 */
export const mmrStore = () => createStore("dotastat-mmr");
