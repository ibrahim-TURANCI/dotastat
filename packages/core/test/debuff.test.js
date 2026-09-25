/**
 * "Debuff" ozelligi: rakipte guclu debuff basan hero varken dispel onerileri.
 *
 * Korunan sozlesmeler:
 *   1. Dispel itemleri (Eul's, Manta, Lotus, Greaves, BKB, Disperser) YALNIZCA
 *      hero'nun kendi gerekli/durumsal listesinde varsa onerilir — oyuncu
 *      satirinda da takim onerisinde de. Plan disina otomatik item eklenmez.
 *   2. Item kademesi korunur: Manta icin once Yasha, Yasha alininca Manta.
 *   3. Pick sirasinda rakipte debuff varsa dispel hero'lari one cikar.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildDraftAdvice } from "../src/draft/draft-advisor.js";
import { heroRecord } from "../src/heroes/hero-catalog.js";
import {
  buildPlayerItemAdvice,
  buildTeamAnalysis,
} from "../src/live/item-advice.js";
import { THREAT_BY_KEY, heroThreats } from "../src/live/threats.js";

const DEBUFF_ITEMS = [
  "cyclone",
  "manta",
  "lotus_orb",
  "guardian_greaves",
  "black_king_bar",
  "disperser",
];

const DISPEL_HEROES = [
  "abaddon",
  "legion_commander",
  "vengefulspirit",
  "omniknight",
  "oracle",
];

/** @param {string[]} heroes */
const rows = (heroes, team) => heroes.map((hero) => ({ hero, team }));

const planOf = (hero) => {
  const record = heroRecord(hero);
  return new Set([...record.requiredItems, ...record.situationalItems]);
};

test("debuff tohumu kullanicinin saydigi hero'lari kapsar", () => {
  const heroes = [
    "venomancer",
    "drow_ranger",
    "silencer",
    "skywrath_mage",
    "slardar",
    "axe",
    "bounty_hunter",
    "disruptor",
    "dazzle",
    "enigma",
    "puck",
    "queenofpain",
    "ogre_magi",
    "batrider",
    "viper",
    "shadow_demon",
    "riki",
    "death_prophet",
    "bloodseeker",
    "ancient_apparition",
    "jakiro",
  ];
  for (const hero of heroes) {
    assert.ok(heroThreats(hero).includes("debuff"), hero + " debuff degil");
  }
  // Genel/kucuk debuff kaynaklari sayilmaz.
  assert.ok(!heroThreats("crystal_maiden").includes("debuff"));

  const def = THREAT_BY_KEY.get("debuff");
  assert.deepEqual(def.items, DEBUFF_ITEMS);
  assert.deepEqual(def.answerHeroes, DISPEL_HEROES);
});

test("oyuncu satirinda dispel itemi yalnizca plandan gelir", () => {
  // Crystal Maiden'in planinda bu itemlerin hicbiri yok (Pipe/Mek var ama
  // onlar debuff cevabi degil).
  const cm = planOf("crystal_maiden");
  const advice = buildPlayerItemAdvice({
    player: { hero: "crystal_maiden", items: [] },
    allies: [],
    enemies: rows(["viper", "silencer"], "radiant"),
    dataLevel: "heroes",
    gameTime: 15 * 60,
    minTotal: 8,
  });
  for (const row of advice) {
    if (
      DEBUFF_ITEMS.includes(row.key) ||
      DEBUFF_ITEMS.includes(row.buildsInto)
    ) {
      assert.ok(cm.has(row.buildsInto || row.key), row.key + " plan disi");
    }
  }
  assert.ok(!advice.some((row) => row.reason.includes("debuff")));
});

test("Manta icin once Yasha, Yasha alininca Manta onerilir", () => {
  assert.ok(planOf("antimage").has("manta"));
  const adviceWith = (items) =>
    buildPlayerItemAdvice({
      player: { hero: "antimage", items },
      allies: [],
      enemies: rows(["silencer"], "radiant"),
      dataLevel: "heroes",
      gameTime: 12 * 60,
      minTotal: 8,
    });

  const first = adviceWith([]).find((row) => row.buildsInto === "manta");
  assert.ok(first, "Manta icin ara parca onerilmeli");
  assert.equal(first.key, "yasha");
  assert.equal(first.group, "counter");
  assert.match(first.reason, /debuff/);

  const second = adviceWith(["yasha"]).find((row) => row.key === "manta");
  assert.ok(second, "Yasha varken Manta onerilmeli");
  assert.equal(second.group, "counter");
  assert.match(second.reason, /debuff/);
});

test("takim onerisinde dispel itemi plansiz Duruma göre'ye dusmez", () => {
  const itemsFor = (allies, enemies = ["viper", "silencer"]) =>
    buildTeamAnalysis({
      allies: rows(allies, "dire"),
      enemies: rows(enemies, "radiant"),
      dataLevel: "heroes",
      myTeam: "dire",
    }).dire.items;

  // Kimsenin planinda Lotus yok -> hic onerilmez.
  assert.ok(!planOf("crystal_maiden").has("lotus_orb"));
  assert.ok(
    !itemsFor(["crystal_maiden"]).some((row) => row.key === "lotus_orb"),
  );

  // Axe'in planinda Lotus var -> Axe'e baglanir.
  assert.ok(planOf("axe").has("lotus_orb"));
  const lotus = itemsFor(["axe"]).find((row) => row.key === "lotus_orb");
  assert.ok(lotus, "planda olan dispel itemi onerilmeli");
  assert.deepEqual(lotus.buyers, ["axe"]);
  assert.match(lotus.reason, /debuff/);

  // Rakipte debuff yoksa Lotus gerekcesi de yok.
  assert.ok(
    !itemsFor(["axe"], ["crystal_maiden"]).some(
      (row) => row.key === "lotus_orb",
    ),
  );
});

test("pick sirasinda rakipte debuff varsa dispel hero'lari one cikar", () => {
  const draft = (dire, heroOverrides) =>
    buildDraftAdvice({
      myTeam: "radiant",
      picks: [
        { hero: "juggernaut", team: "radiant" },
        ...dire.map((hero) => ({ hero, team: "dire" })),
      ],
      phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
      heroOverrides,
    });
  const pos5 = (advice) => advice.blocks.find((row) => row.role === "pos5");

  const withDebuff = pos5(draft(["viper", "silencer", "venomancer"]));
  const dispel = withDebuff.suggestions.filter((row) =>
    DISPEL_HEROES.includes(row.hero),
  );
  assert.ok(dispel.length, "pos5 onerisinde dispel hero'su olmali");
  assert.match(dispel[0].reasons[0], /dispel/);

  // Ayni kadroda debuff isaretleri kaldirilinca gerekce de kalkar.
  const cleared = pos5(
    draft(["viper", "silencer", "venomancer"], {
      viper: { traits: [] },
      silencer: { traits: [] },
      venomancer: { traits: [] },
    }),
  );
  assert.ok(
    !cleared.suggestions.some((row) =>
      row.reasons.some((reason) => reason.includes("dispel")),
    ),
  );
});
