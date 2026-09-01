/**
 * Overwolf / DotaPlus loglarindan CANLI mac zenginlestirmesi.
 *
 * NE ISE YARAR
 * ------------
 * Sen oynarken Dota'nin GSI cikisi YALNIZCA senin oyuncu blogunu gonderir;
 * rakip takimin hangi hero'yu sectigi orada yoktur. Overwolf'un oyun-olay
 * saglayicisi bu bilgiyi goruyor ve DotaPlus onu kendi duz metin loguna
 * yaziyor. Bu servis o loglari izleyip 10 slotun hero'sunu ve rank'ini
 * cikarir.
 *
 * ISTEGE BAGLIDIR
 * ---------------
 * Overwolf ya da DotaPlus kurulu degilse klasor bulunamaz, servis `available:
 * false` der ve HICBIR SEY yapmaz. Uygulamanin geri kalani GSI ile tam olarak
 * eskisi gibi calisir. Bu sinif hicbir kosulda istisna sizdirmemelidir.
 *
 * NASIL OKUR
 * ----------
 * Loglar buyuktur (2 MB'a kadar) ve mac boyunca surekli buyur. Her turda
 * bastan okumak israf olurdu; bu yuzden dosya ARTIMLI okunur: yalnizca son
 * okumadan bu yana eklenen baytlar alinir ve bir tampon metinde biriktirilir.
 * Dosya donduginde (rotasyon) ya da kuculdugunde tampon sifirlanir.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** DotaPlus loglarinin bulundugu klasor. */
const LOG_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "Overwolf",
  "Log",
  "Apps",
  "DotaPlus",
);

/** Uygulamanin akis logu: hero secimleri, banlar, mac kimligi. */
const CONTROLLER_ACTIVE = "controller.html.log";
const CONTROLLER_PATTERN = /^controller\.html.*\.log$/;

/** .NET tarafi: her slotun rank'i, parti, taraf. */
const OBJECT_PATTERN = /^DotaPlusObject_.*\.log$/;

/**
 * Ilk okumada dosyanin sonundan ne kadari alinir. Bir macin tum satirlari
 * bunun cok altinda kalir; daha eskisi zaten gecmis maclara aittir.
 */
const INITIAL_TAIL_BYTES = 512 * 1024;

/** Tamponun ust siniri; asilirsa bastan kirpilir. */
const MAX_BUFFER_CHARS = 1024 * 1024;

/**
 * Draft sirasinda pickler saniyeler icinde degisir; panel geride kalmasin
 * diye siki bir aralik secildi. Okuma artimli oldugu icin maliyeti dusuktur.
 */
const POLL_MS = 2000;

/**
 * Klasordeki en taze dosyayi bulur.
 *
 * @param {RegExp} pattern
 * @param {string} [preferred] Varsa once bu ada bakilir (aktif dosya)
 * @returns {string} Tam yol veya bos metin
 */
function newestLogFile(pattern, preferred) {
  let names = [];
  try {
    names = fs.readdirSync(LOG_DIR);
  } catch {
    // Overwolf/DotaPlus kurulu degil.
    return "";
  }

  if (preferred && names.includes(preferred)) {
    return path.join(LOG_DIR, preferred);
  }

  let best = "";
  let bestTime = -1;
  for (const name of names) {
    if (!pattern.test(name)) {
      continue;
    }
    const full = path.join(LOG_DIR, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs > bestTime) {
        bestTime = stat.mtimeMs;
        best = full;
      }
    } catch {
      // Dosya arada silinmis olabilir; atla.
    }
  }
  return best;
}

/**
 * Tek bir dosyayi artimli okuyan takipci.
 *
 * @param {{ pattern: RegExp, preferred?: string }} options
 */
function createTailReader(options) {
  let filePath = "";
  let offset = 0;
  let buffer = "";

  return {
    /** @returns {{ text: string, path: string, changed: boolean }} */
    read() {
      const next = newestLogFile(options.pattern, options.preferred);
      if (!next) {
        filePath = "";
        offset = 0;
        buffer = "";
        return { text: "", path: "", changed: false };
      }

      let size = 0;
      try {
        size = fs.statSync(next).size;
      } catch {
        return { text: buffer, path: filePath, changed: false };
      }

      // Baska dosyaya gecildi (rotasyon) ya da dosya kuculdu (yeni oturum):
      // biriken tampon artik baska bir maca ait, sifirlanir.
      if (next !== filePath || size < offset) {
        filePath = next;
        buffer = "";
        offset = Math.max(0, size - INITIAL_TAIL_BYTES);
      }

      if (size === offset) {
        return { text: buffer, path: filePath, changed: false };
      }

      let chunk = "";
      let handle = null;
      try {
        handle = fs.openSync(filePath, "r");
        const length = size - offset;
        const bytes = Buffer.alloc(length);
        const read = fs.readSync(handle, bytes, 0, length, offset);
        // DotaPlus loglari tek bayt kodlamalidir; `latin1` hicbir baytta
        // patlamaz ve aradigimiz ASCII anahtar kelimeleri bozmaz.
        chunk = bytes.subarray(0, read).toString("latin1");
        offset += read;
      } catch {
        return { text: buffer, path: filePath, changed: false };
      } finally {
        if (handle !== null) {
          try {
            fs.closeSync(handle);
          } catch {
            // kapatilamadi; onemli degil
          }
        }
      }

      buffer += chunk;
      if (buffer.length > MAX_BUFFER_CHARS) {
        buffer = buffer.slice(buffer.length - MAX_BUFFER_CHARS);
      }
      return { text: buffer, path: filePath, changed: true };
    },

    reset() {
      filePath = "";
      offset = 0;
      buffer = "";
    },
  };
}

/**
 * @param {Object} options
 * @param {typeof import("@dotastat/core")} options.core
 * @param {{ info: Function, warn: Function }} [options.logger]
 * @param {() => boolean} [options.isEnabled] Ayarlardan kapatilabilsin diye
 * @param {(snapshot: Record<string, any>|null) => void} [options.onChange]
 * @param {number} [options.pollMs]
 */
function createOverwolfWatcher(options) {
  const core = options.core;
  const logger = options.logger || console;
  const pollMs = Number(options.pollMs) || POLL_MS;
  const isEnabled =
    typeof options.isEnabled === "function" ? options.isEnabled : () => true;

  const controller = createTailReader({
    pattern: CONTROLLER_PATTERN,
    preferred: CONTROLLER_ACTIVE,
  });
  const object = createTailReader({ pattern: OBJECT_PATTERN });

  let timer = null;
  /** @type {Record<string, any>|null} */
  let snapshot = null;
  let lastSignature = "";
  let status = {
    available: false,
    enabled: true,
    matchId: "",
    activity: "",
    picks: 0,
    ranks: 0,
    at: "",
    error: "henuz-okunmadi",
  };

  /** Degisiklik tespiti: yalnizca ekrana yansiyan alanlara bakilir. */
  function signatureOf(row) {
    if (!row) {
      return "";
    }
    return [
      row.matchId,
      row.activity,
      row.ended ? "ended" : "",
      (row.players || [])
        .map(
          (player) =>
            player.index +
            ":" +
            (player.hero || "") +
            ":" +
            (player.heroConfirmed === false ? "?" : "") +
            (player.rank || 0),
        )
        .join(","),
      (row.bans || []).map((ban) => ban.hero).join(","),
    ].join("|");
  }

  /**
   * Loglari okuyup goruntuyu tazeler.
   * @returns {Record<string, any>|null}
   */
  function sync() {
    if (!isEnabled()) {
      snapshot = null;
      lastSignature = "";
      status = { ...status, enabled: false, error: "kapali" };
      return null;
    }

    let next = null;
    try {
      const controllerRead = controller.read();
      const objectRead = object.read();

      if (!controllerRead.path && !objectRead.path) {
        snapshot = null;
        lastSignature = "";
        status = {
          available: false,
          enabled: true,
          matchId: "",
          activity: "",
          picks: 0,
          ranks: 0,
          at: "",
          error: "dotaplus-logu-yok",
        };
        return null;
      }

      next = core.buildOverwolfSnapshot({
        controllerText: controllerRead.text,
        objectText: objectRead.text,
      });
    } catch (error) {
      // Log bicimi degismis olabilir. Uygulamanin geri kalani etkilenmez.
      status = {
        ...status,
        available: false,
        error: String(error?.message || error),
      };
      return snapshot;
    }

    snapshot = next;
    status = {
      available: Boolean(next?.matchId),
      enabled: true,
      matchId: next?.matchId || "",
      activity: next?.activity || "",
      picks: (next?.picks || []).length,
      ranks: (next?.players || []).filter((row) => row.rank > 0).length,
      at: next?.at || "",
      error: next?.matchId ? "" : "canli-mac-yok",
    };

    const signature = signatureOf(next);
    if (signature !== lastSignature) {
      lastSignature = signature;
      if (typeof options.onChange === "function") {
        try {
          options.onChange(next);
        } catch (error) {
          logger.warn?.(
            "Overwolf degisikligi islenemedi",
            String(error?.message || error),
          );
        }
      }
    }

    return next;
  }

  return {
    start() {
      if (timer) {
        return;
      }
      sync();
      timer = setInterval(sync, pollMs);
      timer.unref?.();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    /** Son okunan goruntu (okuma yapmadan). */
    snapshot: () => snapshot,

    /** Elle tazeleme. */
    sync,

    /** Debug panelinde gosterilir. */
    status: () => ({ ...status, logDir: LOG_DIR }),
  };
}

module.exports = {
  createOverwolfWatcher,
  LOG_DIR,
};
