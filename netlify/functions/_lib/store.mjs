/**
 * Kalici depolama katmani (Netlify Blobs).
 *
 * Uc ayri kova kullanilir:
 *   - `players`  : OpenDota mac onbellegi (oyuncu basina, TTL'li)
 *   - `live`     : masaustu istemcisinin gonderdigi canli mac durumu
 *   - `presence` : online kullanicilar (heartbeat)
 *
 * Netlify Blobs kullanilamadiginda (ornegin `netlify dev` disinda yerel
 * calistirma) sureç ici bellege duser. Bellek yedegi sadece gelistirme
 * kolayligi icindir; production'da Blobs her zaman vardir.
 */

import { getStore } from "@netlify/blobs";

/** @type {Map<string, Map<string, { value: unknown, expiresAt: number }>>} */
const memoryStores = new Map();

/**
 * @param {string} name
 */
function memoryStore(name) {
  if (!memoryStores.has(name)) {
    memoryStores.set(name, new Map());
  }
  return memoryStores.get(name);
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

  return {
    name,
    usingBlobs: Boolean(blobs),

    /**
     * @param {string} key
     * @returns {Promise<unknown|null>}
     */
    async get(key) {
      if (blobs) {
        try {
          const row = await blobs.get(key, { type: "json" });
          if (!row) {
            return null;
          }
          if (row.expiresAt && Date.now() > row.expiresAt) {
            return null;
          }
          return row.value === undefined ? row : row.value;
        } catch {
          return null;
        }
      }

      const row = memoryStore(name).get(key);
      if (!row) {
        return null;
      }
      if (row.expiresAt && Date.now() > row.expiresAt) {
        memoryStore(name).delete(key);
        return null;
      }
      return row.value;
    },

    /**
     * @param {string} key
     * @param {unknown} value
     * @param {{ ttlMs?: number }} [options]
     */
    async set(key, value, options = {}) {
      const expiresAt = options.ttlMs ? Date.now() + Number(options.ttlMs) : 0;
      const row = { value, expiresAt, savedAt: Date.now() };

      if (blobs) {
        try {
          await blobs.setJSON(key, row);
          return true;
        } catch {
          return false;
        }
      }

      memoryStore(name).set(key, row);
      return true;
    },

    /**
     * @param {string} key
     */
    async remove(key) {
      if (blobs) {
        try {
          await blobs.delete(key);
          return true;
        } catch {
          return false;
        }
      }
      memoryStore(name).delete(key);
      return true;
    },

    /**
     * Kovadaki tum anahtarlari dondurur (presence listesi icin).
     * @returns {Promise<string[]>}
     */
    async keys() {
      if (blobs) {
        try {
          const listing = await blobs.list();
          return (listing?.blobs || []).map((row) => row.key);
        } catch {
          return [];
        }
      }
      return Array.from(memoryStore(name).keys());
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
