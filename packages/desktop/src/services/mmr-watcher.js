/**
 * DotaPlus log dosyasindan MMR okuyucu.
 *
 * NEDEN BOYLE: Dota 2 MMR degerini hicbir genel API'den vermiyor — GSI'de yok,
 * OpenDota ve Stratz'ta yok, konsolda yok, diske de yazilmiyor. Deger yalnizca
 * oyun istemcisinin bellegindedir ve oraya Overwolf'un Game Events Provider'i
 * (dota2.exe icine enjekte olan bilesen) erisebiliyor.
 *
 * Overwolf uzerinde calisan DotaPlus uygulamasi bu degeri okuyup KENDI DUZ
 * METIN LOGUNA yaziyor. Biz o dosyayi okuyoruz — Dota'ya, bellege ya da baska
 * bir surece dokunmadan. VAC riski yoktur, yalnizca dosya okumasi yapilir.
 *
 * Log satiri (gercek ornek):
 *   2026-08-30 06:55:32,245 (INFO) </6823....js> (:2) -
 *     matchStore: Processing MMR: "{\"mmr\": 3620,\"confidence\" : 100, ...}"
 *
 * KIRILGANLIK: bu, baska bir urunun ic log bicimidir, bir API degildir.
 * DotaPlus bicimi degistirirse okuma sessizce durur — uygulama calismaya devam
 * eder, yalnizca MMR sutunu bos kalir. Okunan degerler kendi depomuza yazildigi
 * icin gecmis kaybolmaz.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readSessionCookie } = require("./cloud-session.js");

/** DotaPlus loglarinin bulundugu klasor. */
const LOG_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "Overwolf",
  "Log",
  "Apps",
  "DotaPlus",
);

/** `controller.html.log` ve donmus kopyalari (`controller.html.87.log`). */
const LOG_FILE_PATTERN = /^controller\.html.*\.log$/;

/**
 * Log satirindan zaman ve MMR ceker.
 *
 * Zaman damgasi yereldir (saat dilimi yazmaz), bu yuzden yerel saat olarak
 * yorumlanip ISO'ya cevrilir.
 */
const MMR_LINE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}),\d+ .*Processing MMR: "\{\\"mmr\\": (\d+)/;

/** Ne siklikta bakilir. Log yalnizca mac sonlarinda degisir, sik olmasi gereksiz. */
const POLL_MS = 60 * 1000;

/**
 * Bir log dosyasindaki MMR okumalarini cikarir.
 *
 * @param {string} filePath
 * @returns {Array<{ at: string, mmr: number }>}
 */
function parseLogFile(filePath) {
  let text = "";
  try {
    text = fs.readFileSync(filePath, "latin1");
  } catch {
    return [];
  }

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = MMR_LINE.exec(line);
    if (!match) {
      continue;
    }
    const [, year, month, day, hour, minute, second, mmr] = match;
    // Yerel saat olarak kur; Date bunu dogru sekilde UTC'ye cevirir.
    const at = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    if (Number.isFinite(at.getTime())) {
      rows.push({ at: at.toISOString(), mmr: Number(mmr) });
    }
  }
  return rows;
}

/**
 * Klasordeki tum log dosyalarini okur.
 * @returns {Array<{ at: string, mmr: number }>}
 */
function readAllLogs() {
  let names = [];
  try {
    names = fs.readdirSync(LOG_DIR);
  } catch {
    // DotaPlus kurulu degil; sessizce bos don.
    return [];
  }

  const rows = [];
  for (const name of names) {
    if (LOG_FILE_PATTERN.test(name)) {
      rows.push(...parseLogFile(path.join(LOG_DIR, name)));
    }
  }
  return rows;
}

/**
 * @param {Object} options
 * @param {{ get: Function, set: Function }} options.storage
 * @param {typeof import("@dotastat/core")} options.core
 * @param {{ info: Function, warn: Function }} [options.logger]
 * @param {number} [options.pollMs]
 */
function createMmrWatcher(options) {
  const storage = options.storage;
  const core = options.core;
  const logger = options.logger || console;
  const pollMs = Number(options.pollMs) || POLL_MS;

  let timer = null;
  let lastResult = { available: false, samples: 0, at: "", error: "" };

  /** Depodaki gecmis. */
  async function history() {
    const row = await storage.get("mmr:history");
    return Array.isArray(row?.samples) ? row.samples : [];
  }

  /**
   * Loglari okuyup yeni degerleri depoya ekler.
   * @returns {Promise<Array<{ at: string, mmr: number }>>}
   */
  async function sync() {
    const incoming = readAllLogs();
    if (!incoming.length) {
      lastResult = {
        available: false,
        samples: (await history()).length,
        at: new Date().toISOString(),
        error: "dotaplus-logu-yok",
      };
      return history();
    }

    const merged = core.mergeMmrSamples(await history(), incoming);
    await storage.set("mmr:history", {
      samples: merged,
      updatedAt: new Date().toISOString(),
    });

    lastResult = {
      available: true,
      samples: merged.length,
      at: new Date().toISOString(),
      error: "",
    };

    // Siteye ilet: arkadaslarin sayfasindan bakildiginda da kendi MMR
    // degisimini gorebilsin. Basarisiz olursa sessizce gecilir; yerel gecmis
    // zaten kaydedildi ve bir sonraki turda yeniden denenir.
    await upload(merged);
    return merged;
  }

  /**
   * Okumalari siteye gonderir. Kimlik Steam oturum cerezinden gelir; ayri bir
   * gizli anahtar gerekmez.
   *
   * @param {Array<{ at: string, mmr: number }>} samples
   */
  async function upload(samples) {
    const config =
      typeof options.getConfig === "function" ? options.getConfig() : null;
    const cloudUrl = String(config?.cloudUrl || "").trim();
    if (!cloudUrl || !samples.length) {
      return;
    }

    const cookie = await readSessionCookie(cloudUrl);
    if (!cookie) {
      // Siteye giris yapilmamis; MMR yalnizca bu bilgisayarda gorunur.
      return;
    }

    try {
      await fetch(cloudUrl.replace(/\/+$/, "") + "/api/me/mmr", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ samples }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      logger.warn?.("MMR siteye iletilemedi", String(error?.message || error));
    }
  }

  return {
    /** Arka planda periyodik okumayi baslatir. */
    start() {
      if (timer) {
        return;
      }
      sync().catch((error) =>
        logger.warn?.("MMR okunamadi", String(error?.message || error)),
      );
      timer = setInterval(() => {
        sync().catch((error) =>
          logger.warn?.("MMR okunamadi", String(error?.message || error)),
        );
      }, pollMs);
      // Uygulama kapanirken surecin beklemesine gerek yok.
      timer.unref?.();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    /** Depodaki tum okumalar. */
    history,

    /** Elle tazeleme (ayar ekrani / debug icin). */
    sync,

    /** Son okuma durumu (debug panelinde gosterilir). */
    status: () => ({ ...lastResult, logDir: LOG_DIR }),
  };
}

module.exports = {
  createMmrWatcher,
  LOG_DIR,
  // Testlerde kullanilabilsin diye ayrica disari verilir.
  parseLogFile,
};
