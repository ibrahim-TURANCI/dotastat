/**
 * Oyun tarzi ve guclu / zayif yonler maclardan turer.
 *
 *   - Yeterli mac yoksa hicbir yorum uretilmez.
 *   - Bir yon ancak ortalamasi belirgin VE maclarin cogunda ayni yondeyse
 *     yazilir; tek bir uc mac sonucu degistirmez.
 *   - Rol dagilimi degerlendirmenin kullandigi pozisyondan gelir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPlayerStyle } from "../src/players/player-style.js";

/**
 * @param {string} id
 * @param {Record<string, number>} scores faktor -> puan
 * @param {Record<string, any>} [extra]
 */
function pair(id, scores, extra = {}) {
  return {
    match: {
      matchId: id,
      kills: 4,
      deaths: 6,
      assists: 14,
      teamKills: 30,
      gpm: 320,
      xpm: 420,
      heroDamage: 18000,
      towerDamage: 500,
      durationSeconds: 2400,
      obsPlaced: 8,
      senPlaced: 6,
      ...extra,
    },
    evaluation: {
      matchId: id,
      role: extra.role || "pos4",
      breakdown: Object.entries(scores).map(([key, score]) => ({ key, score })),
    },
  };
}

function build(pairs) {
  return buildPlayerStyle({
    matches: pairs.map((row) => row.match),
    evaluations: pairs.map((row) => row.evaluation),
  });
}

test("oyun tarzi: az macta yorum yok", () => {
  const style = build(
    Array.from({ length: 4 }, (_, index) =>
      pair(String(index), { fightParticipation: 0.8 }),
    ),
  );
  assert.equal(style.enough, false);
  assert.equal(style.sample, 4);
  assert.deepEqual(style.strengths, []);
  assert.deepEqual(style.weaknesses, []);
});

test("oyun tarzi: tutarli faktorler guclu / zayif, tutarsiz olan gelisim", () => {
  const pairs = Array.from({ length: 8 }, (_, index) =>
    pair(String(index), {
      // Her macta iyi -> guclu.
      fightParticipation: 0.6,
      // Her macta kotu -> zayif.
      survivability: -0.5,
      // 3/8 macta kotu, ortalamasi notr -> gelisim.
      visionContribution: index < 3 ? -0.6 : 0.3,
      // Tek bir cok iyi mac, gerisi notr -> hicbir listede yok.
      damageContribution: index === 0 ? 1 : 0,
    }),
  );
  const style = build(pairs);

  assert.equal(style.enough, true);
  assert.deepEqual(
    style.strengths.map((row) => row.key),
    ["fightParticipation"],
  );
  assert.equal(style.strengths[0].label, "Fight katılımı");
  assert.equal(style.strengths[0].text, "ort. %60 kill katılımı");
  assert.deepEqual(
    style.weaknesses.map((row) => row.key),
    ["survivability"],
  );
  assert.equal(style.weaknesses[0].text, "maç başına 6 ölüm");
  assert.deepEqual(
    style.development.map((row) => row.key),
    ["visionContribution"],
  );
  assert.ok(
    !style.strengths.some((row) => row.key === "damageContribution"),
    "tek bir uc mac guclu yon yapmaz",
  );
});

test("oyun tarzi: rol dagilimi ve ortalamalar", () => {
  const pairs = [
    ...Array.from({ length: 6 }, (_, index) =>
      pair("a" + index, {}, { role: "pos4" }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      pair("b" + index, {}, { role: "pos5" }),
    ),
    // %15'in altindaki rol listelenmez.
    pair("c", {}, { role: "pos1" }),
  ];
  const style = build(pairs);
  assert.deepEqual(style.roles, [
    { role: "pos4", share: 0.6 },
    { role: "pos5", share: 0.3 },
  ]);
  assert.equal(style.averages.kills, 4);
  assert.equal(style.averages.participation, 0.6);
  assert.equal(style.averages.gpm, 320);
});

test("oyun tarzi: degerlendirmesi olmayan mac sayilmaz, eksik veri hata vermez", () => {
  assert.equal(buildPlayerStyle({}).enough, false);
  const style = buildPlayerStyle({
    matches: [{ matchId: "1" }, null, { matchId: "2" }],
    evaluations: [{ matchId: "1", breakdown: [] }],
  });
  assert.equal(style.sample, 1);
});
