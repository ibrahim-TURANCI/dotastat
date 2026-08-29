/**
 * Hero havuzu turetme testleri.
 *
 * Buradaki asil sozlesme "hangi liste hangi pencereye bakar" sorusudur:
 * imza TUM oyunlara, tercih SON maclara. Bu ayrim bozulursa iki liste
 * birbirinin kopyasi olur ve ozellik anlamini yitirir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHeroPool,
  buildPreferredHeroes,
  buildSignatureHeroes,
  buildWeakHeroes,
  shrunkWinRate,
} from "../src/players/hero-pool.js";

/**
 * @param {string} hero
 * @param {number} matches
 * @param {number} wins
 */
const lifetimeRow = (hero, matches, wins) => ({
  hero,
  matches,
  wins,
  winRate: matches ? wins / matches : 0,
});

/**
 * @param {string} hero
 * @param {number} index Ne kadar eski (0 = en yeni)
 * @param {"win"|"loss"} result
 */
const match = (hero, index, result = "win") => ({
  matchId: String(1000 + index),
  hero,
  result,
  startedAt: new Date(Date.UTC(2026, 0, 1) - index * 3600_000).toISOString(),
  durationSeconds: 2100,
});

test("kucuk ornekli kazanma orani 0.5'e cekilir", () => {
  // 2 macta 2 galibiyet %100 degil, ~%58 sayilmali.
  const small = shrunkWinRate(2, 2);
  assert.ok(small > 0.5 && small < 0.7, `beklenmeyen oran: ${small}`);

  // 200 macta 140 galibiyet ise ham oran neredeyse korunur.
  const large = shrunkWinRate(140, 200);
  assert.ok(Math.abs(large - 0.7) < 0.02, `beklenmeyen oran: ${large}`);
});

test("imza kahramanlar tum oyunlara bakar, son maclara degil", () => {
  const lifetime = [
    lifetimeRow("dark_seer", 150, 90),
    lifetimeRow("enigma", 60, 36),
  ];
  // Son maclarin tamami baska bir hero; imza listesi bundan etkilenmemeli.
  const matches = Array.from({ length: 20 }, (_, i) => match("pudge", i));

  const pool = buildHeroPool({ lifetime, matches, player: null });

  assert.deepEqual(
    pool.signature.map((row) => row.hero),
    ["dark_seer", "enigma"],
  );
  assert.ok(
    !pool.signature.some((row) => row.hero === "pudge"),
    "son maclardaki hero imza listesine sizmamali",
  );
});

test("tercih listesi son maclardan gelir ve imzayi tekrarlamaz", () => {
  const lifetime = [lifetimeRow("dark_seer", 150, 90)];
  const matches = [
    ...Array.from({ length: 10 }, (_, i) => match("pudge", i)),
    ...Array.from({ length: 10 }, (_, i) => match("dark_seer", i + 10)),
  ];

  const pool = buildHeroPool({ lifetime, matches, player: null });

  assert.equal(pool.signature[0].hero, "dark_seer");
  assert.equal(pool.preferred[0].hero, "pudge");
  assert.ok(
    !pool.preferred.some((row) => row.hero === "dark_seer"),
    "imza kahraman tercih listesinde tekrarlanmamali",
  );
});

test("tercihte yeni maclar eskilerden agir basar", () => {
  // Ikisi de 8 mac; ama biri son 8 macta, digeri 8 mac oncesinde.
  const matches = [
    ...Array.from({ length: 8 }, (_, i) => match("lion", i)),
    ...Array.from({ length: 8 }, (_, i) => match("lina", i + 8)),
  ];

  const preferred = buildPreferredHeroes(matches);
  assert.equal(preferred[0].hero, "lion");
});

test("cok oynanip kaybedilen hero imza degil zayif sayilir", () => {
  const lifetime = [
    lifetimeRow("dark_seer", 120, 70),
    lifetimeRow("axe", 40, 12), // %30
  ];

  const signature = buildSignatureHeroes(lifetime).map((row) => row.hero);
  const weak = buildWeakHeroes(lifetime).map((row) => row.hero);

  assert.ok(!signature.includes("axe"), "axe imza olmamali");
  assert.ok(weak.includes("axe"), "axe zayif listesinde olmali");
  assert.ok(signature.includes("dark_seer"));
});

test("tavsiye listesi az oynanmis yuksek oranli heroyu one alir", () => {
  const lifetime = [
    lifetimeRow("dark_seer", 120, 70),
    lifetimeRow("tidehunter", 4, 3), // az oynanmis, %75
  ];
  const player = {
    dotaProfile: { primaryRole: "pos3", secondaryRoles: [] },
  };

  const pool = buildHeroPool({ lifetime, matches: [], player });

  assert.equal(pool.recommended[0].hero, "tidehunter");
  assert.match(pool.recommended[0].reason, /az oynanmış/);
});

test("tavsiye listesi zaten cok oynanan heroyu onermez", () => {
  const lifetime = [lifetimeRow("dark_seer", 120, 70)];
  const pool = buildHeroPool({ lifetime, matches: [], player: null });

  assert.ok(
    !pool.recommended.some((row) => row.hero === "dark_seer"),
    "havuzda zaten olan hero tavsiye edilmemeli",
  );
});

test("tum zamanlar verisi yoksa son maclara duser", () => {
  const matches = Array.from({ length: 20 }, (_, i) => match("dark_seer", i));
  const pool = buildHeroPool({ lifetime: [], matches, player: null });

  assert.equal(pool.derivedFrom, "recent");
  assert.equal(pool.signature[0].hero, "dark_seer");
});

test("rol degisince tavsiye siralamasi degisir", () => {
  const lifetime = [lifetimeRow("dark_seer", 60, 33)];
  const asOfflane = buildHeroPool({
    lifetime,
    matches: [],
    player: { dotaProfile: { primaryRole: "pos3", secondaryRoles: [] } },
  });
  const asCarry = buildHeroPool({
    lifetime,
    matches: [],
    player: { dotaProfile: { primaryRole: "pos1", secondaryRoles: [] } },
  });

  assert.notDeepEqual(
    asOfflane.recommended.map((row) => row.hero),
    asCarry.recommended.map((row) => row.hero),
    "pozisyon tavsiyeleri etkilemeli",
  );
});
