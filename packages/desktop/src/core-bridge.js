/**
 * `@dotastat/core` koprusu.
 *
 * NEDEN VAR
 * ---------
 * Masaustu paketi CommonJS'tir: Electron ana sureci, electron-builder ve
 * electron-updater ile en uyumlu kurulum budur (preload betikleri de zaten
 * CJS olmak zorunda). Bu yuzden ana surec ve servisler CJS yazilmistir.
 *
 * `@dotastat/core` ise saf ES modulu olarak kalir; tarayici ve Netlify
 * tarafinda da ayni kod calissin diye. Iki dunya arasindaki TEK gecis noktasi
 * bu dosyadir: cekirdek bir kez dinamik `import()` ile yuklenir, sonuc
 * onbelleklenir ve ihtiyaci olan modullere parametre olarak gecirilir.
 */

/** @type {Promise<typeof import("@dotastat/core")>|null} */
let pending = null;

/**
 * Cekirdek modulu yukler (ilk cagrida import eder, sonra onbellekten doner).
 * @returns {Promise<typeof import("@dotastat/core")>}
 */
function loadCore() {
  if (!pending) {
    pending = import("@dotastat/core");
  }
  return pending;
}

module.exports = { loadCore };
