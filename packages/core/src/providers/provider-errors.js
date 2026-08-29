/**
 * Saglayici hatalarinin ortak siniflandirmasi.
 *
 * Zincir (bkz. provider-chain.js) bir saglayicidan digerine gecmeye karar
 * verirken hatanin turune bakar: gunluk limit / gecici sunucu hatasi ise
 * sonraki kaynak denenir, "oyuncu yok" gibi kalici hatalarda denenmez.
 */

/** Gunluk veya dakikalik istek limiti dolmus. */
export const RATE_LIMIT = "rate-limit";
/** Saglayici gecici olarak erisilemiyor (5xx, timeout, ag hatasi). */
export const UNAVAILABLE = "unavailable";
/** Anahtar yok veya gecersiz; bu saglayici hic kullanilamaz. */
export const NOT_CONFIGURED = "not-configured";
/** Kaynak gercekten yok (404) — baska saglayici da bulamaz.  */
export const NOT_FOUND = "not-found";

/**
 * @param {string} message
 * @param {string} code
 * @param {string} [provider]
 * @returns {Error & { code: string, provider: string }}
 */
export function providerError(message, code, provider = "") {
  const error = /** @type {Error & { code: string, provider: string }} */ (
    new Error(message)
  );
  error.code = code;
  error.provider = provider;
  return error;
}

/**
 * HTTP durum kodundan hata sinifi cikarir.
 * @param {number} status
 * @returns {string}
 */
export function codeFromStatus(status) {
  if (status === 429 || status === 402) {
    return RATE_LIMIT;
  }
  if (status === 401 || status === 403) {
    return NOT_CONFIGURED;
  }
  if (status === 404) {
    return NOT_FOUND;
  }
  return UNAVAILABLE;
}

/**
 * Bu hatada sonraki saglayiciya gecmeli miyiz?
 * @param {unknown} error
 * @returns {boolean}
 */
export function shouldFailover(error) {
  const code = String(/** @type {any} */ (error)?.code || "");
  return code !== NOT_FOUND;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  return String(/** @type {any} */ (error)?.code || "") === RATE_LIMIT;
}
