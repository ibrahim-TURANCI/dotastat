/**
 * Kadro degisiklik katmaninin yuklenmesi ve yazilmasi.
 *
 * Kadro okumalari (`listRoster`, `findRosterPlayer`) cekirdekte senkrondur;
 * katman her fonksiyonun basinda `loadRoster()` ile depodan yuklenir. Kab
 * sicak kaldikca kisa bir hafiza kullanilir: kadro nadiren degisir ama
 * `/api/live` 5 saniyede bir yoklaniyor.
 *
 * Baska bir kapta yapilan degisiklik en fazla MEMO_TTL_MS gecikmeyle gorunur;
 * degisikligi yapan kapta hemen gecerlidir (bkz. saveRosterOverrides).
 */

import { applyRosterOverrides } from "@dotastat/core";
import { rosterStore } from "./store.mjs";

const OVERRIDES_KEY = "roster:overrides";
const MEMO_TTL_MS = 30 * 1000;

let loadedAt = 0;
/** @type {Promise<void>|null} */
let inFlight = null;

/**
 * Katmani depodan okuyup cekirdege uygular. Depo okunamazsa son yuklenen
 * katman (hic yoksa tohum veri) kullanilmaya devam eder.
 *
 * @param {{ fresh?: boolean }} [options]
 */
export async function loadRoster(options = {}) {
  if (!options.fresh && Date.now() - loadedAt < MEMO_TTL_MS) {
    return;
  }
  if (!inFlight) {
    inFlight = rosterStore()
      .get(OVERRIDES_KEY)
      .then((row) => {
        applyRosterOverrides(row);
        loadedAt = Date.now();
      })
      .catch(() => {
        // Depo okunamadi: elimizdeki kadroyla devam.
      })
      .finally(() => {
        inFlight = null;
      });
  }
  await inFlight;
}

/**
 * @param {Record<string, any>} overrides normalize edilmis katman
 * @param {string} accountId Degistiren kisi (iz olarak saklanir)
 */
export async function saveRosterOverrides(overrides, accountId) {
  await rosterStore().set(OVERRIDES_KEY, {
    ...overrides,
    updatedAt: new Date().toISOString(),
    updatedBy: String(accountId || ""),
  });
  applyRosterOverrides(overrides);
  loadedAt = Date.now();
}
