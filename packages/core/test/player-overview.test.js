/**
 * Son Maclar kadro eslesmesi ve Genel sekmesinin veriden uretilen ozeti.
 *
 *   - Ayni matchId kadroda birden fazla kiside geciyorsa o macta birlikteler.
 *   - Taraf (side) varsa ona, yoksa sonuca bakilir.
 *   - Eksik veri hata vermez.
 *   - Ozet deterministiktir: ayni veri ayni tavsiyeleri ve imzayi uretir;
 *     yeni mac gelince imza degisir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildMatchSquads } from "../src/players/match-squads.js";
import { buildPlayerOverview } from "../src/players/player-overview.js";

/**
 * @param {string} id
 * @param {"win"|"loss"} result
 * @param {Record<string, any>} [extra]
 */
function match(id, result, extra = {}) {
  return {
    matchId: id,
    hero: "juggernaut",
    result,
    kills: 5,
    deaths: 3,
    assists: 7,
    startedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

test("kadro eslesmesi: ayni macta oynayan arkadaslar sayilir", () => {
  const mine = [match("1", "win"), match("2", "loss"), match("3", "win")];
  const squads = buildMatchSquads({
    playerId: "janissary",
    matches: mine,
    roster: [
      { id: "janissary", name: "Janissary", matches: mine },
      {
        id: "bontala",
        name: "BONTALA",
        matches: [match("1", "win", { hero: "lion" }), match("2", "loss")],
      },
      { id: "galleleon", name: "Galleleon", matches: [match("1", "win")] },
    ],
  });

  assert.equal(squads["1"].allies, 3);
  assert.deepEqual(
    squads["1"].members.map((row) => row.name),
    ["Janissary", "BONTALA", "Galleleon"],
  );
  assert.equal(squads["1"].members[1].hero, "lion");
  assert.equal(squads["2"].allies, 2);
  assert.equal(squads["3"].allies, 1, "tek basina oynanan mac");
});

test("kadro eslesmesi: karsi takimdaki kadro uyesi ayrilir", () => {
  const mine = [match("9", "win", { side: "radiant" })];
  const squads = buildMatchSquads({
    playerId: "a",
    matches: mine,
    roster: [
      { id: "a", name: "A", matches: mine },
      // Taraf bilgisi varsa sonuca bakilmaz.
      { id: "b", name: "B", matches: [match("9", "loss", { side: "dire" })] },
      // Eski kayit: taraf yok, sonuc farkli -> rakip.
      { id: "c", name: "C", matches: [match("9", "loss")] },
    ],
  });
  assert.equal(squads["9"].allies, 1);
  assert.equal(squads["9"].enemies, 2);
  assert.equal(squads["9"].members.at(-1).team, "enemy");
});

test("kadro eslesmesi: eksik veri hata vermez", () => {
  assert.deepEqual(buildMatchSquads({}), {});
  const squads = buildMatchSquads({
    playerId: "x",
    matches: [match("5", "win")],
    roster: [null, { id: "y" }],
  });
  assert.equal(squads["5"].allies, 1);
  assert.ok(squads["5"].members[0].self);
});

test("genel ozet: bos veride hata vermez ve tavsiye uretmez", () => {
  const overview = buildPlayerOverview({});
  assert.equal(overview.hasData, false);
  assert.deepEqual(overview.tips, []);
});

test("genel ozet: maglubiyet serisi ve zayif hero tavsiyesi", () => {
  const matches = [
    match("10", "loss", { hero: "pudge" }),
    match("9", "loss", { hero: "pudge" }),
    match("8", "loss", { hero: "pudge" }),
    match("7", "win", { hero: "juggernaut" }),
    match("6", "win", { hero: "juggernaut" }),
    match("5", "win", { hero: "juggernaut" }),
  ];
  const overview = buildPlayerOverview({ matches });

  assert.equal(overview.recent.streak.type, "loss");
  assert.equal(overview.recent.streak.count, 3);
  const keys = overview.tips.map((row) => row.key);
  assert.ok(keys.includes("streak-loss-3"));
  assert.ok(keys.includes("hero-weak-pudge"));
  assert.ok(keys.includes("hero-strong-juggernaut"));
  // Metin hero'nun gorunen adini kullanir.
  assert.ok(overview.tips.some((row) => row.text.includes("Juggernaut")));
});

test("genel ozet: sinerji kadro eslesmesinden turer", () => {
  const matches = ["1", "2", "3", "4"].map((id) => match(id, "win"));
  const squads = Object.fromEntries(
    matches.map((row) => [
      row.matchId,
      {
        members: [
          { id: "me", name: "Ben", self: true, team: "ally" },
          { id: "bontala", name: "BONTALA", team: "ally" },
        ],
        allies: 2,
        enemies: 0,
      },
    ]),
  );
  const overview = buildPlayerOverview({ matches, squads });
  assert.equal(overview.synergy.partners[0].name, "BONTALA");
  assert.equal(overview.synergy.stack.matches, 4);
  assert.ok(overview.tips.some((row) => row.key === "partner-strong-bontala"));
  assert.equal(overview.recent.matches[0].stack, 2);
});

test("genel ozet: ayni veri ayni sonucu, yeni mac yeni imzayi uretir", () => {
  const matches = [match("2", "win"), match("1", "loss")];
  const first = buildPlayerOverview({ matches });
  const again = buildPlayerOverview({ matches: [...matches] });
  assert.deepEqual(first, again);

  const next = buildPlayerOverview({
    matches: [match("3", "win"), ...matches],
  });
  assert.notEqual(next.signature, first.signature);
});

test("genel ozet: performans egilimi Performance Rank'tan olculur", () => {
  const matches = Array.from({ length: 12 }, (_, index) =>
    match(String(100 - index), "win"),
  );
  const evaluations = matches.map((row, index) => ({
    matchId: row.matchId,
    performanceRank: index < 5 ? 2400 : 3000,
  }));
  const overview = buildPlayerOverview({ matches, evaluations });
  assert.equal(overview.performance.recentAvgRank, 2400);
  assert.equal(overview.performance.delta, -600);
  assert.equal(overview.performance.trend, "down");
  assert.ok(overview.tips.some((row) => row.key === "perf-down"));
});
