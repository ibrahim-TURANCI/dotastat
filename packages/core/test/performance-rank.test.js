/**
 * Performance Rank hesabinin iki sozlesmesi:
 *
 *   1. Hero havuzu kademesi bir ONCELIKTIR, olcum degil. Zayif isaretli bir
 *      heroda iyi oynanan mac "hero zayif" gerekcesiyle asagi cekilemez.
 *   2. Sonuc, oynanan macin ortalama seviyesine dogru cekilir. Tek mac,
 *      ortalamadan cok uzak bir seviyeyi kanitlamaya yetmez.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMatchPlayer } from "../src/players/performance-evaluation-engine.js";
import { normalizePlayer } from "../src/players/player-normalizer.js";

/** Legend 1 -> ~3157 MMR; sabit bir mac ortalamasi icin kullaniliyor. */
const LEGEND_1_TIER = 51;

/**
 * @param {Partial<import("../src/players/player-types.js").PlayerMatch>} [overrides]
 */
function sampleMatch(overrides = {}) {
  return {
    matchId: "9000",
    playerId: "1",
    startedAt: new Date().toISOString(),
    durationSeconds: 38 * 60,
    hero: "windranger",
    role: "pos2",
    result: "win",
    kills: 11,
    deaths: 3,
    assists: 14,
    gpm: 620,
    xpm: 700,
    heroDamage: 32000,
    heroHealing: 0,
    towerDamage: 6000,
    lastHits: 280,
    denies: 12,
    obsPlaced: null,
    senPlaced: null,
    campsStacked: null,
    teamKills: 34,
    teamDeaths: 20,
    laneResult: "won",
    averageRankTier: null,
    provider: "opendota",
    ...overrides,
  };
}

/**
 * @param {string[]} weakHeroes
 * @param {string[]} [signatureHeroes]
 */
function samplePlayer(weakHeroes, signatureHeroes = []) {
  return normalizePlayer({
    id: "test",
    name: "Test",
    player_id: "1",
    dotaProfile: {
      primaryRole: "pos2",
      weakHeroes,
      signatureHeroes,
    },
    performanceProfile: {
      strongHeroPerformance: { min: 3000, max: 3500 },
      averageHeroPerformance: { min: 2500, max: 3000 },
      weakHeroPerformance: { min: 1800, max: 2000 },
      actualRank: 3000,
    },
  });
}

test("zayif isaretli heroda iyi oynanan mac hero yuzunden dusmez", () => {
  const match = sampleMatch();

  const weak = evaluateMatchPlayer({
    player: samplePlayer(["windranger"]),
    match,
  });
  const neutral = evaluateMatchPlayer({ player: samplePlayer([]), match });

  // Kademe hala bir ipucu: sonuc esit degil, ama fark profil bantlari
  // arasindaki ~900'luk ucurum kadar buyuk olamaz.
  assert.ok(
    weak.performanceRank < neutral.performanceRank,
    "kademe tamamen yok sayilmamali",
  );
  assert.ok(
    neutral.performanceRank - weak.performanceRank < 300,
    `iyi macta kademe cezasi erimeliydi, fark ${
      neutral.performanceRank - weak.performanceRank
    }`,
  );
  assert.ok(
    weak.performanceRank > 2500,
    `zayif heroda iyi mac 2500 ustu olmali, ${weak.performanceRank} bulundu`,
  );
});

test("imza heroda kotu oynanan mac kademe bonusu almaz", () => {
  const badMatch = sampleMatch({
    result: "loss",
    kills: 1,
    deaths: 12,
    assists: 3,
    gpm: 250,
    xpm: 300,
    heroDamage: 8000,
    towerDamage: 300,
    lastHits: 90,
    teamKills: 12,
    teamDeaths: 35,
    laneResult: "lost",
  });

  const signature = evaluateMatchPlayer({
    player: samplePlayer([], ["windranger"]),
    match: badMatch,
  });
  const neutral = evaluateMatchPlayer({
    player: samplePlayer([]),
    match: badMatch,
  });

  assert.ok(
    signature.performanceRank - neutral.performanceRank < 300,
    "gozlem celisiyorken kademe bonusu erimeliydi",
  );
});

test("sonuc macin ortalama rankina dogru cekilir", () => {
  const player = samplePlayer([]);
  const evaluation = evaluateMatchPlayer({
    player,
    match: sampleMatch({ averageRankTier: LEGEND_1_TIER }),
  });

  const raw = evaluation.rawPerformanceRank;
  const average = evaluation.matchAverageRank;

  assert.equal(evaluation.matchAverageRankSource, "match");
  assert.ok(average > 0);
  // Ceyrek yol: raw + (ortalama - raw) * 0.25. Beklenen deger yuvarlanmis
  // ara degerlerden yeniden kuruldugu icin 1 birim pay birakiliyor.
  const expected = raw + (average - raw) * 0.25;
  assert.ok(
    Math.abs(evaluation.performanceRank - expected) <= 1,
    `beklenen ~${Math.round(expected)}, bulunan ${evaluation.performanceRank}`,
  );
  // Cekme her zaman ortalamaya YAKLASTIRIR, karsiya gecirmez.
  assert.ok(
    Math.abs(evaluation.performanceRank - average) < Math.abs(raw - average),
  );
});

test("dusuk tahmin macin ortalamasina dogru YUKARI cekilir", () => {
  const player = samplePlayer(["windranger"]);
  const evaluation = evaluateMatchPlayer({
    player,
    match: sampleMatch({
      averageRankTier: LEGEND_1_TIER,
      result: "loss",
      kills: 1,
      deaths: 14,
      assists: 2,
      gpm: 210,
      xpm: 260,
      heroDamage: 5000,
      towerDamage: 0,
      lastHits: 70,
      teamKills: 10,
      teamDeaths: 40,
      laneResult: "lost",
    }),
  });

  assert.ok(
    evaluation.performanceRank > evaluation.rawPerformanceRank,
    "ortalamanin altindaki tahmin yukari cekilmeli",
  );
});

test("mac ortalamasi gelmezse oyuncunun kendi rankindan tahmin edilir", () => {
  const player = { ...samplePlayer([]), rank: { medal: 5, stars: 1 } };
  const evaluation = evaluateMatchPlayer({ player, match: sampleMatch() });

  assert.equal(evaluation.matchAverageRankSource, "player");
  assert.ok(evaluation.matchAverageRank > 0);
  // Tahmin oldugu icin cekme daha yumusak: olculmus ortalamadan daha az kaydirir.
  const measured = evaluateMatchPlayer({
    player,
    match: sampleMatch({ averageRankTier: LEGEND_1_TIER }),
  });
  assert.ok(
    Math.abs(evaluation.performanceRank - evaluation.rawPerformanceRank) <
      Math.abs(measured.performanceRank - measured.rawPerformanceRank),
  );
});

test("oyuncu bilinmiyorsa cekme uygulanmaz", () => {
  const evaluation = evaluateMatchPlayer({
    player: null,
    match: sampleMatch(),
  });

  assert.equal(evaluation.matchAverageRank, 0);
  assert.equal(evaluation.matchAverageRankSource, "");
  assert.equal(evaluation.performanceRank, evaluation.rawPerformanceRank);
});
