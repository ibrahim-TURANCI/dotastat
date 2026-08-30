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
  latestMmr,
  mergeMmrSamples,
  MMR_PER_STAR,
  rankProgress,
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

test("rank ilerlemesi gercek degerle dogrulanir", () => {
  // Oyuncunun kendi verisi: MMR 3620, oyunda Legend 4 (rank_tier 54),
  // oyun ici gostergede "bir sonraki rank icin 76 MMR".
  const progress = rankProgress(3620);

  assert.equal(progress.label, "Legend 4");
  assert.equal(progress.medal, 5);
  assert.equal(progress.stars, 4);
  assert.equal(progress.remaining, 76);
  assert.equal(progress.next, 3696);
});

test("yildiz sinirinda madalya dogru atlar", () => {
  // 24 * 154 = 3696 -> Legend 5'in tabani
  assert.equal(rankProgress(3696).label, "Legend 5");
  // 25 * 154 = 3850 -> Ancient 1
  assert.equal(rankProgress(3850).label, "Ancient 1");
  // Tam tabandayken tum yildiz mesafesi kalir
  assert.equal(rankProgress(3850).remaining, MMR_PER_STAR);
});

test("Immortal'da bir sonraki esik yoktur", () => {
  const progress = rankProgress(6000);
  assert.equal(progress.isTop, true);
  assert.equal(progress.remaining, 0);
  assert.equal(progress.label, "Immortal");
});

test("MMR bilinmiyorsa ilerleme uretilmez", () => {
  assert.equal(rankProgress(0), null);
  assert.equal(rankProgress(undefined), null);
});

test("en son MMR sirasiz veriden de dogru bulunur", () => {
  const value = latestMmr([
    sample("2026-08-29T10:00:00Z", 3560),
    sample("2026-08-29T16:36:00Z", 3620),
    sample("2026-08-29T12:00:00Z", 3594),
  ]);
  assert.equal(value, 3620);
  assert.equal(latestMmr([]), 0);
});

test("okuma mac bitisinden ONCE gelse de dogru maca yazilir", () => {
  // Gercek olcum: mac bitisi `startedAt + durationSeconds` ile hesaplaninca
  // gercek bitisten 1-3 dakika sonraya dusuyor, kaynak ise MMR'i mac biter
  // bitmez okuyor. "Once bitmis olmali" sarti bu yuzden her degeri bir onceki
  // maca kaydiriyordu.
  const matches = [
    match("200", "2026-08-29T15:54:00Z", 2580), // 16:37 bitti
    match("100", "2026-08-29T15:05:00Z", 1500), // 15:30 bitti
  ];
  const samples = [
    sample("2026-08-29T15:27:00Z", 3594), // 100'un bitisinden 3 dk ONCE
    sample("2026-08-29T16:36:00Z", 3620), // 200'un bitisinden 1 dk ONCE
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });
  assert.equal(byMatch["200"].mmr, 3620, "son okuma son maca ait olmali");
  assert.equal(byMatch["200"].delta, 26);
});

test("gercek veri: her galibiyet arti, her yenilgi eksi almali", () => {
  // Isaret uyumu en guclu dogrulama: kayip bir maca pozitif MMR yazmak
  // gozle gorulur bir hatadir. Asagidaki dizi oyuncunun gercek verisidir.
  const base = Date.UTC(2026, 7, 29, 11, 0, 0);
  const rows = [
    { hero: "sand_king", result: "loss", start: 0, dur: 2040, mmr: 3540 },
    { hero: "shredder", result: "loss", start: 78, dur: 1920, mmr: 3520 },
    { hero: "magnataur", result: "loss", start: 136, dur: 2220, mmr: 3499 },
    { hero: "treant", result: "win", start: 178, dur: 1860, mmr: 3531 },
    { hero: "mirana", result: "win", start: 216, dur: 1440, mmr: 3564 },
    { hero: "skeleton_king", result: "win", start: 245, dur: 1500, mmr: 3594 },
    { hero: "pudge", result: "win", start: 294, dur: 2580, mmr: 3620 },
  ];

  const matches = rows.map((row, index) => ({
    ...match(
      String(index + 1),
      new Date(base + row.start * 60_000).toISOString(),
      row.dur,
    ),
    result: row.result,
  }));

  // Okumalar mac bitisinden 2 dakika ONCE geliyor (olculen davranis).
  const samples = [
    { at: new Date(base - 60_000).toISOString(), mmr: 3555 },
    ...rows.map((row) => ({
      at: new Date(base + (row.start + row.dur / 60 - 2) * 60_000).toISOString(),
      mmr: row.mmr,
    })),
  ];

  const byMatch = attributeMmrToMatches({ matches, samples });

  for (const [index, row] of rows.entries()) {
    const change = byMatch[String(index + 1)];
    assert.ok(change, `${row.hero} icin MMR eslesmeliydi`);
    assert.equal(change.mmr, row.mmr, `${row.hero} yanlis MMR aldi`);
    assert.equal(
      change.delta > 0,
      row.result === "win",
      `${row.hero}: ${row.result} macinda ${change.delta} celiskili`,
    );
  }
});
