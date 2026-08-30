/**
 * MMR gecmisi ve mac eslestirmesi testleri.
 *
 * Korunan sozlesme: bir MMR degisimi, kendisinden ONCE biten en yakin maca
 * aittir. Yanlis maca yazmak, oyuncuya kaybettigi macta puan kazanmis gibi
 * gostermek demektir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  attributeMmrToMatches,
  mergeMmrSamples,
  toMmrChanges,
} from "../src/players/mmr-history.js";

/**
 * @param {string} at ISO
 * @param {number} mmr
 */
const sample = (at, mmr) => ({ at, mmr });

/**
 * @param {string} matchId
 * @param {string} startedAt ISO
 * @param {number} durationSeconds
 */
const match = (matchId, startedAt, durationSeconds) => ({
  matchId,
  startedAt,
  durationSeconds,
});

test("tekrarlanan ayni deger degisim sayilmaz", () => {
  const changes = toMmrChanges([
    sample("2026-08-29T10:00:00Z", 3560),
    sample("2026-08-29T10:00:05Z", 3560),
    sample("2026-08-29T10:00:10Z", 3560),
  ]);
  assert.equal(changes.length, 0, "deger degismediyse degisim uretilmemeli");
});

test("degisimler sirali ve dogru farkla cikar", () => {
  const changes = toMmrChanges([
    // Bilerek karisik sirada: modul kendisi siralamali.
    sample("2026-08-29T12:00:00Z", 3594),
    sample("2026-08-29T10:00:00Z", 3560),
    sample("2026-08-29T11:00:00Z", 3536),
  ]);

  assert.deepEqual(
    changes.map((row) => row.delta),
    [-24, 58],
  );
  assert.equal(changes[0].mmr, 3536);
  assert.equal(changes[1].mmr, 3594);
});

test("degisim kendisinden once biten maca yazilir", () => {
  // Mac 10:00'da basladi, 40 dakika surdu -> 10:40'ta bitti.
  const matches = [match("100", "2026-08-29T10:00:00Z", 2400)];
  const samples = [
    sample("2026-08-29T09:59:00Z", 3560), // mactan once okunan taban
    sample("2026-08-29T10:45:00Z", 3586), // mactan 5 dk sonra
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });

  assert.equal(byMatch["100"].delta, 26);
  assert.equal(byMatch["100"].mmr, 3586);
});

test("pencere disindaki degisim hicbir maca yazilmaz", () => {
  const matches = [match("100", "2026-08-29T10:00:00Z", 2400)];
  const samples = [
    sample("2026-08-29T09:59:00Z", 3560),
    // Mac 10:40'ta bitti; bu okuma ERTESI GUN. Arada oynanmis ve
    // kaydedilmemis maclar olabilecegi icin bu maca yazilamaz.
    sample("2026-08-30T10:40:00Z", 3586),
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });
  assert.deepEqual(byMatch, {});
});

test("mac BITMEDEN once okunan deger o maca yazilmaz", () => {
  const matches = [match("100", "2026-08-29T10:00:00Z", 2400)];
  const samples = [
    sample("2026-08-29T09:00:00Z", 3560),
    // Mac suruyorken okundu (10:20). Bu onceki maclara ait olabilir.
    sample("2026-08-29T10:20:00Z", 3586),
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });
  assert.equal(byMatch["100"], undefined);
});

test("gec gelen okuma da dogru maca baglanir", () => {
  // Gercek loglarda olculen gecikme: mac bitiminden ~1 saat sonra okuma.
  const matches = [match("100", "2026-08-29T10:00:00Z", 2400)]; // 10:40 bitti
  const samples = [
    sample("2026-08-29T09:00:00Z", 3560),
    sample("2026-08-29T11:45:00Z", 3586), // 65 dakika sonra
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });
  assert.equal(byMatch["100"].delta, 26, "gec okuma da maca yazilmali");
});

test("ardisik maclar dogru siraya baglanir", () => {
  const matches = [
    match("100", "2026-08-29T10:00:00Z", 2400), // 10:40 bitti
    match("200", "2026-08-29T11:00:00Z", 2400), // 11:40 bitti
  ];
  const samples = [
    sample("2026-08-29T09:59:00Z", 3560),
    sample("2026-08-29T10:45:00Z", 3586), // 1. mac -> +26
    sample("2026-08-29T11:45:00Z", 3561), // 2. mac -> -25
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });

  assert.equal(byMatch["100"].delta, 26);
  assert.equal(byMatch["200"].delta, -25);
});

test("bir maca birden fazla degisim yazilmaz", () => {
  const matches = [match("100", "2026-08-29T10:00:00Z", 2400)];
  const samples = [
    sample("2026-08-29T09:59:00Z", 3560),
    sample("2026-08-29T10:45:00Z", 3586),
    sample("2026-08-29T10:50:00Z", 3600), // ayni pencerede ikinci degisim
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });
  assert.equal(Object.keys(byMatch).length, 1);
  assert.equal(byMatch["100"].delta, 26, "ilk eslesme korunmali");
});

test("gecmis birlestirilirken tekrarlar elenir ve sira korunur", () => {
  const merged = mergeMmrSamples(
    [sample("2026-08-29T10:00:00Z", 3560)],
    [
      sample("2026-08-29T10:00:00Z", 3560), // ayni kayit
      sample("2026-08-29T09:00:00Z", 3535), // daha eski
      sample("2026-08-29T11:00:00Z", 3586),
    ],
  );

  assert.deepEqual(
    merged.map((row) => row.mmr),
    [3535, 3560, 3586],
  );
});

test("gercek veri: gozlemlenen degisimler dogru cikar", () => {
  // DotaPlus logundan okunan gercek dizinin bir bolumu.
  const samples = [
    sample("2026-08-29T16:50:03Z", 3499),
    sample("2026-08-29T17:26:11Z", 3531),
    sample("2026-08-29T17:57:27Z", 3564),
    sample("2026-08-29T18:27:05Z", 3594),
    sample("2026-08-29T19:36:10Z", 3620),
  ];

  assert.deepEqual(
    toMmrChanges(samples).map((row) => row.delta),
    [32, 33, 30, 26],
  );
});
