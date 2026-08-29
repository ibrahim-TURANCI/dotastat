/**
 * Basit dosya + konsol gunlukleyici.
 *
 * Kurulu uygulamada konsol gorunmedigi icin son satirlar bellekte de tutulur;
 * debug paneli ve tepsi menusu buradan okuyabilir.
 */

const fs = require("node:fs");
const path = require("node:path");

const MAX_MEMORY_LINES = 300;

/**
 * @param {{ dir: string, fileName?: string }} options
 */
function createLogger(options) {
  const fileName = options.fileName || "dotastat.log";
  const filePath = path.join(options.dir, fileName);
  /** @type {string[]} */
  const lines = [];

  try {
    fs.mkdirSync(options.dir, { recursive: true });
  } catch {
    // Klasor acilamazsa yalnizca konsola yazilir.
  }

  /**
   * @param {string} level
   * @param {unknown[]} args
   */
  function write(level, args) {
    const text =
      new Date().toISOString() +
      " [" +
      level +
      "] " +
      args
        .map((value) =>
          typeof value === "string" ? value : safeStringify(value),
        )
        .join(" ");

    lines.push(text);
    if (lines.length > MAX_MEMORY_LINES) {
      lines.shift();
    }

    // eslint-disable-next-line no-console
    console[level === "error" ? "error" : "log"](text);

    try {
      fs.appendFileSync(filePath, text + "\n", "utf8");
    } catch {
      // Disk yazilamiyorsa gunluk sadece bellekte kalir.
    }
  }

  return {
    filePath,
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args),
    recent: (count = 80) => lines.slice(-count),
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

module.exports = {
  createLogger,
};
