/**
 * Rakip kompozisyonundaki tehditler ve onlara verilen cevaplar.
 *
 * Korunan sozlesmeler:
 *   1. Oyuncu satirindaki oneri YALNIZCA o hero'nun kendi listelerinden cikar.
 *      Rakip, havuza item EKLEMEZ; havuzdakileri siralar.
 *   2. Takim onerisi rakip kompozisyonundan turer ve yalnizca TAKIMDAN BIRININ
 *      planinda olan itemleri gosterir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { heroRecord } from "../src/heroes/hero-catalog.js";
import {
  buildPlayerItemAdvice,
  buildTeamAnalysis,
} from "../src/live/item-advice.js";
import { THREATS, detectThreats, heroThreats } from "../src/live/threats.js";

/** @param {string[]} heroes */
const rows = (heroes, team) => heroes.map((hero) => ({ hero, team }));

/** Bir hero'nun planindaki tum itemler. */
const planOf = (hero) => {
  const record = heroRecord(hero);
  return new Set([...record.requiredItems, ...record.situationalItems]);
};

test("tehdit listeleri kullanicinin saydigi hero'lari kapsar", () => {
  // Bu ornekler kullanicidan geldi; kural degisirse burada patlamali.
  const expected = {
    invisible: ["weaver", "mirana", "bounty_hunter", "riki"],
    regen: ["necrolyte", "alchemist", "huskar", "wisp"],
    escape: ["puck", "storm_spirit", "ember_spirit", "antimage"],
    magical: ["zuus", "leshrac", "skywrath_mage", "snapfire", "venomancer"],
    targeted: ["legion_commander", "pudge", "antimage", "lina", "spirit_breaker"],
    passive: ["bristleback", "phantom_assassin", "dragon_knight"],
  };

  for (const [key, heroes] of Object.entries(expected)) {
    for (const hero of heroes) {
      assert.ok(
        heroThreats(hero).includes(key),
        hero + " icin '" + key + "' tehdidi tanimli degil",
      );
    }
  }
});

test("her tehdit bir cevap itemi tasir", () => {
  for (const threat of THREATS) {
    assert.ok(threat.items.length, threat.key + " icin cevap itemi yok");
    assert.ok(threat.heroes.length, threat.key + " icin hero listesi bos");
    assert.ok(threat.label && threat.reason, threat.key + " icin metin eksik");
  }
});

test("tehdit yalnizca sahadaki hero'lardan cikarilir", () => {
  const found = detectThreats(rows(["riki", "zuus"], "dire"));
  const keys = found.map((row) => row.key);

  assert.ok(keys.includes("invisible"));
  assert.ok(keys.includes("magical"));
  assert.ok(!keys.includes("regen"), "sahada olmayan tehdit uretilmemeli");

  const invisible = found.find((row) => row.key === "invisible");
  assert.deepEqual(invisible.heroes, ["riki"]);
});

test("oyuncu onerisi hero'nun KENDI listelerinin disina cikmaz", () => {
  // Somut sikayet: Dawnbreaker'a Linken's Sphere, Eul's, Force Staff
  // oneriliyordu — hicbiri planinda olmadigi halde. Sebep rakip hero'larin
  // counter listesinin havuza eklenmesiydi.
  const plan = planOf("dawnbreaker");
  const advice = buildPlayerItemAdvice({
    player: { hero: "dawnbreaker", team: "dire", items: [], backpack: [] },
    allies: [],
    enemies: rows(
      ["lina", "antimage", "keeper_of_the_light", "shadow_shaman", "zuus"],
      "radiant",
    ),
    dataLevel: "heroes",
  });

  assert.ok(advice.length > 0);
  for (const row of advice) {
    assert.ok(
      plan.has(row.key),
      row.key + " Dawnbreaker'in planinda yok ama onerildi",
    );
  }
});

test("rakip, hero'nun planindaki cevabi basa tasir", () => {
  // Black King Bar Dawnbreaker'in cekirdek planinda; rakip buyu hasari
  // bastiginda gerekcesi degisir ve karsi hamle grubuna gecer.
  const advice = buildPlayerItemAdvice({
    player: { hero: "dawnbreaker", team: "dire", items: [], backpack: [] },
    allies: [],
    enemies: rows(["zuus", "lina", "leshrac"], "radiant"),
    dataLevel: "heroes",
  });

  const bkb = advice.find((row) => row.key === "black_king_bar");
  assert.ok(bkb, "cevap itemi onerilmeli");
  assert.equal(bkb.group, "counter");
  assert.match(bkb.reason, /büyü hasarı/);
  // Gerekce tehdidi TASIYAN hero'yu adiyla soyler.
  assert.match(bkb.reason, /Zeus/);
});

test("rakip gorunmuyorsa tehdit uretilmez", () => {
  const advice = buildPlayerItemAdvice({
    player: { hero: "dawnbreaker", team: "dire", items: [], backpack: [] },
    allies: [],
    enemies: [],
    dataLevel: "self",
  });

  assert.ok(!advice.some((row) => row.group === "counter"));
});

test("takim onerisi yalnizca takimdan BIRININ planindaki itemleri gosterir", () => {
  const allies = rows(
    ["dawnbreaker", "crystal_maiden", "juggernaut", "tidehunter", "lion"],
    "dire",
  );
  const enemies = rows(
    ["zuus", "riki", "necrolyte", "legion_commander", "bristleback"],
    "radiant",
  );

  const analysis = buildTeamAnalysis({
    allies,
    enemies,
    dataLevel: "heroes",
    myTeam: "dire",
  });

  assert.ok(analysis.dire.items.length > 0);
  for (const item of analysis.dire.items) {
    assert.ok(item.buyers?.length, item.key + " icin alici yok");
    for (const hero of item.buyers) {
      assert.ok(
        planOf(hero).has(item.key),
        item.key + " " + hero + " planinda yok",
      );
    }
  }
});

test("ayni tehdide cevap veren itemlerden yalnizca planda OLANLAR cikar", () => {
  // Pipe ve Mekansm ikisi de buyu hasarina cevap veriyor. Planinda Pipe olan
  // hero varsa Pipe, Mekansm olan varsa Mekansm, ikisi de varsa ikisi birden.
  const enemies = rows(["zuus", "leshrac", "lina"], "radiant");

  /** Verilen kadroyla hangi buyu cevaplari onerildi? */
  const answersFor = (heroes) => {
    const analysis = buildTeamAnalysis({
      allies: rows(heroes, "dire"),
      enemies,
      dataLevel: "heroes",
      myTeam: "dire",
    });
    return analysis.dire.items.map((row) => row.key);
  };

  // Planinda Mekansm olan ama Pipe olmayan bir kadro seclim.
  const withMek = ["crystal_maiden"];
  assert.ok(planOf("crystal_maiden").has("mekansm"));
  const mekOnly = answersFor(withMek);
  assert.ok(mekOnly.includes("mekansm"));

  // Hicbirinin planinda Pipe/Mekansm olmayan bir kadroda ikisi de cikmamali.
  const withNeither = ["antimage"];
  const plan = planOf("antimage");
  assert.ok(!plan.has("pipe") && !plan.has("mekansm"));
  const neither = answersFor(withNeither);
  assert.ok(!neither.includes("pipe"));
  assert.ok(!neither.includes("mekansm"));
});

test("tehdit listesi analiz ciktisinda taraf taraf doner", () => {
  const analysis = buildTeamAnalysis({
    allies: rows(["dawnbreaker", "lion"], "dire"),
    enemies: rows(["riki", "zuus"], "radiant"),
    dataLevel: "heroes",
    myTeam: "dire",
  });

  // Dire'ye gorunen tehditler RADIANT'in tasidiklaridir.
  const direThreats = analysis.dire.threats.map((row) => row.key);
  assert.ok(direThreats.includes("invisible"));
  assert.ok(direThreats.includes("magical"));

  // Radiant'a gorunenler de Dire'nin tasidiklari.
  const radiantThreats = analysis.radiant.threats.map((row) => row.key);
  assert.ok(!radiantThreats.includes("invisible"));
});

test("sahip olunan item tekrar onerilmez", () => {
  const analysis = buildTeamAnalysis({
    allies: [
      { hero: "crystal_maiden", team: "dire", items: ["mekansm"], backpack: [] },
    ],
    enemies: rows(["zuus", "leshrac"], "radiant"),
    dataLevel: "full",
    myTeam: "dire",
  });

  assert.ok(!analysis.dire.items.some((row) => row.key === "mekansm"));
});
