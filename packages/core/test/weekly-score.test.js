/**
 * Haftalik siralama testleri.
 *
 * Korunan sozlesme: ORNEK SAYISI siralamayi belirler. Tek mac oynayip kazanan
 * biri haftanin birincisi olamaz — istenen davranis bu, tesadufi degil.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyEntry,
  buildWeeklyScoreboard,
} from "../src/players/weekly-score.js";
import {
  approximateMmrFromRank,
  rankProgress,
  resolveRankProgress,
} from "../src/players/mmr-history.js";

const NOW = new Date("2026-08-31T12:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * @param {string} matchId
 * @param {"win"|"loss"} result
 * @param {number} daysAgo
 */
function match(matchId, result, daysAgo) {
  return {
    matchId,
    result,
    startedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    durationSeconds: 2400,
  };
}

/**
 * @param {Array<Record<string, any>>} matches
 * @param {number} performanceRank
 */
function evaluationsFor(matches, performanceRank) {
  return matches.map((row) => ({ matchId: row.matchId, performanceRank }));
}

test("tek mac kazanan, cok oynayip iyi giden oyuncuyu geride birakamaz", () => {
  const luckyMatches = [match("1", "win", 1)];
  const grinderMatches = [
    match("10", "win", 1),
    match("11", "win", 2),
    match("12", "loss", 2),
    match("13", "win", 3),
    match("14", "win", 3),
    match("15", "loss", 4),
    match("16", "win", 5),
    match("17", "win", 5),
    match("18", "loss", 6),
    match("19", "win", 6),
  ];

  const board = buildWeeklyScoreboard({
    now: NOW,
    entries: [
      {
        player: { id: "lucky", name: "Lucky" },
        matches: luckyMatches,
        evaluations: evaluationsFor(luckyMatches, 4000),
      },
      {
        player: { id: "grinder", name: "Grinder" },
        matches: grinderMatches,
        evaluations: evaluationsFor(grinderMatches, 4000),
      },
    ],
  });

  assert.equal(board.winner.id, "grinder");
  assert.equal(board.loser.id, "lucky");
});

test("kaybeden hafta, sonuncu yapar", () => {
  const good = [
    match("1", "win", 1),
    match("2", "win", 2),
    match("3", "win", 3),
  ];
  const bad = [
    match("20", "loss", 1),
    match("21", "loss", 2),
    match("22", "loss", 3),
    match("23", "win", 4),
  ];

  const board = buildWeeklyScoreboard({
    now: NOW,
    entries: [
      { player: { id: "a", name: "A" }, matches: good },
      { player: { id: "b", name: "B" }, matches: bad },
    ],
  });

  assert.equal(board.winner.id, "a");
  assert.equal(board.loser.id, "b");
  assert.ok(board.loser.score < board.winner.score);
});

test("7 gunden eski maclar haftaya sayilmaz, taban olarak kullanilir", () => {
  const matches = [
    match("1", "win", 2),
    match("2", "win", 3),
    // Pencerenin disinda: haftalik sayima girmez.
    match("90", "loss", 12),
    match("91", "loss", 14),
  ];
  const entry = buildWeeklyEntry({
    now: NOW,
    player: { id: "a", name: "A" },
    matches,
    evaluations: [
      { matchId: "1", performanceRank: 4400 },
      { matchId: "2", performanceRank: 4400 },
      { matchId: "90", performanceRank: 4000 },
      { matchId: "91", performanceRank: 4000 },
    ],
  });

  assert.equal(entry.matches, 2, "yalnizca son 7 gun sayilmali");
  assert.equal(entry.wins, 2);
  assert.equal(entry.performanceRank, 4400);
  assert.equal(entry.baselinePerformanceRank, 4000);
  assert.equal(entry.performanceDelta, 400);
  assert.equal(entry.hasBaseline, true);
});

test("olculen MMR degisimi tahminin yerine gecer", () => {
  const matches = [match("1", "win", 1), match("2", "loss", 2)];
  // Ilk maci OLCULMUS (+40), ikincisi olculmemis (tahmin -25).
  const first = matches[0];
  const endedAt =
    new Date(first.startedAt).getTime() + first.durationSeconds * 1000;

  const entry = buildWeeklyEntry({
    now: NOW,
    player: { id: "a", name: "A" },
    matches,
    samples: [
      { at: new Date(endedAt - 30 * 60 * 1000).toISOString(), mmr: 3600 },
      { at: new Date(endedAt + 10 * 60 * 1000).toISOString(), mmr: 3640 },
    ],
  });

  assert.equal(entry.measuredMatches, 1);
  assert.equal(entry.mmrSource, "partial");
  assert.equal(entry.mmrDelta, 40 - 25);
});

test("maci olmayan oyuncu siralamaya girmez", () => {
  const board = buildWeeklyScoreboard({
    now: NOW,
    entries: [
      { player: { id: "a", name: "A" }, matches: [match("1", "win", 1)] },
      { player: { id: "b", name: "B" }, matches: [match("2", "loss", 1)] },
      { player: { id: "c", name: "C" }, matches: [match("3", "win", 30)] },
    ],
  });

  assert.deepEqual(
    board.idle.map((row) => row.id),
    ["c"],
  );
  assert.equal(board.rows.at(-1).id, "c", "maci olmayan en sona yazilir");
  assert.notEqual(board.loser.id, "c", "maci olmayan 'kaybeden' sayilmaz");
});

test("madalyadan turetilen MMR, rankProgress ile ayni madalyayi verir", () => {
  for (let medal = 1; medal <= 7; medal += 1) {
    for (let stars = 1; stars <= 5; stars += 1) {
      const mmr = approximateMmrFromRank({ medal, stars });
      const back = rankProgress(mmr);
      assert.equal(back.medal, medal, `madalya ${medal}-${stars} kaydi`);
      assert.equal(back.stars, stars, `yildiz ${medal}-${stars} kaydi`);
    }
  }
});

test("olculen deger varsa yaklasik tahmin kullanilmaz", () => {
  const measured = resolveRankProgress({
    samples: [{ at: "2026-08-30T10:00:00Z", mmr: 3620 }],
    rank: { medal: 3, stars: 1 },
  });
  assert.equal(measured.approximate, false);
  assert.equal(measured.mmr, 3620);
  assert.equal(measured.label, "Legend 4");

  const estimated = resolveRankProgress({
    samples: [],
    rank: { medal: 5, stars: 4 },
  });
  assert.equal(estimated.approximate, true);
  assert.equal(estimated.label, "Legend 4");
  assert.equal(estimated.remaining, 77);

  assert.equal(resolveRankProgress({ samples: [], rank: null }), null);
});
