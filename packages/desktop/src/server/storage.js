/**
 * Disk uzerinde JSON tabanli anahtar/deger deposu.
 *
 * `@dotastat/core` icindeki `createPlayerDataService` in bekledigi depolama
 * sozlesmesini (get/set) uygular. Netlify tarafinda ayni sozlesmeyi Netlify
 * Blobs karsilar; is mantigi degismez, yalnizca depo degisir.
 *
 * Yazma islemleri once gecici dosyaya yapilir, sonra yerine tasinir; boylece
 * uygulama yazma sirasinda kapanirsa dosya bozulmaz.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * @param {string} filePath deponun tutulacagi JSON dosyasi
 */
function createFileStore(filePath) {
  /** @type {Record<string, { value: unknown, expiresAt: number }>} */
  let cache = null;

  function load() {
    if (cache) {
      return cache;
    }
    try {
      cache = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!cache || typeof cache !== "object") {
        cache = {};
      }
    } catch {
      cache = {};
    }
    return cache;
  }

  function persist() {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = filePath + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(cache), "utf8");
    fs.renameSync(temporary, filePath);
  }

  return {
    /**
     * @param {string} key
     * @returns {Promise<unknown|null>}
     */
    async get(key) {
      const row = load()[key];
      if (!row) {
        return null;
      }
      if (row.expiresAt && Date.now() > row.expiresAt) {
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
      load()[key] = {
        value,
        expiresAt: options.ttlMs ? Date.now() + Number(options.ttlMs) : 0,
        savedAt: Date.now(),
      };
      persist();
    },

    /**
     * @param {string} key
     */
    async remove(key) {
      delete load()[key];
      persist();
    },

    /**
     * @returns {Promise<string[]>}
     */
    async keys() {
      return Object.keys(load());
    },
  };
}

module.exports = {
  createFileStore,
};
