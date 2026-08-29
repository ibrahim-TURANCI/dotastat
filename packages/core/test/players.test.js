import assert from "node:assert/strict";
import test from "node:test";

import {
  findRosterPlayer,
  listRoster,
  toAccountId,
  toSteamId64,
} from "../src/players/roster.js";
import {
  buildPlayerEvaluation,
  resolveEffectivePotential,
} from "../src/players/evaluation.js";
import {
  heroDisplayName,
  heroImageUrl,
  normalizeHeroKey,
} from "../src/heroes/hero-names.js";

test("roster tohum veriden yuklenir", () => {
  const roster = listRoster();
  assert.ok(roster.length > 0);
  for (const player of roster) {
    assert.match(player.player_id, /^\d+$/);
    assert.ok(player.name);
  }
});

test("oyuncu slug, account id ve SteamID64 ile bulunur", () => {
  const player = listRoster()[0];
  assert.equal(findRosterPlayer(player.id)?.id, player.id);
  assert.equal(findRosterPlayer(player.player_id)?.id, player.id);
  assert.equal(findRosterPlayer(toSteamId64(player.player_id))?.id, player.id);
  assert.equal(findRosterPlayer("bilinmeyen-oyuncu"), null);
});

test("SteamID64 ve account id birbirine cevrilir", () => {
  assert.equal(toAccountId("76561198161274190"), "201008462");
  assert.equal(toSteamId64("201008462"), "76561198161274190");
  assert.equal(toAccountId("201008462"), "201008462");
  assert.equal(toAccountId("gecersiz"), "");
});

test("hero anahtarlari takma adlardan cozulur", () => {
  assert.equal(
    normalizeHeroKey("npc_dota_hero_phantom_assassin"),
    "phantom_assassin",
  );
  assert.equal(normalizeHeroKey("Queen of Pain"), "queenofpain");
  assert.equal(normalizeHeroKey("Magnus"), "magnataur");
  assert.equal(heroDisplayName("dark_seer"), "Dark Seer");
  assert.match(heroImageUrl("windranger"), /windrunner\.png$/);
});

test("etkin potansiyel az ornekte profil beklentisinde kalir", () => {
  const player = {
    performanceProfile: { strongHeroPerformance: { min: 5000, max: 6000 } },
  };
  const result = resolveEffectivePotential(player, {
    averagePerformanceRank: 3000,
    matches: 2,
  });

  assert.equal(result.source, "profile");
  assert.equal(result.min, 5000);
  assert.equal(result.max, 6000);
});

test("etkin potansiyel yeterli ornekte gozleme dogru kayar", () => {
  const player = {
    performanceProfile: { strongHeroPerformance: { min: 5000, max: 6000 } },
  };
  const result = resolveEffectivePotential(player, {
    averagePerformanceRank: 4000,
    matches: 10,
  });

  assert.equal(result.source, "blended");
  assert.ok(result.min < 5000, "gozlem dusukse potansiyel asagi cekilmeli");
  // Profil beklentisi tamamen yok sayilmaz: kayma en fazla farkin yarisi kadar.
  assert.ok(
    result.delta >= -750,
    "kayma tavani asilmamali, delta: " + result.delta,
  );
});

test("mac listesinden degerlendirme paketi uretilir", () => {
  const player = findRosterPlayer(listRoster()[0].id);
  const matches = [
    {
      matchId: "1",
      playerId: player.player_id,
      startedAt: new Date().toISOString(),
      durationSeconds: 2100,
      hero: "dark_seer",
      role: "pos3",
      result: "win",
      kills: 4,
      deaths: 3,
      assists: 14,
      gpm: 420,
      xpm: 520,
      heroDamage: 18000,
      heroHealing: 0,
      towerDamage: 1200,
      lastHits: 120,
      denies: 8,
      provider: "test",
    },
  ];

  const evaluation = buildPlayerEvaluation({ player, matches });

  assert.equal(evaluation.evaluations.length, 1);
  assert.ok(evaluation.evaluations[0].performanceRank > 0);
  assert.equal(evaluation.form.matches, 1);
  assert.equal(evaluation.form.wins, 1);
  assert.equal(evaluation.stats.heroes[0].hero, "dark_seer");
});
