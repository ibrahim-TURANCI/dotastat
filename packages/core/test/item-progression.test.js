/**
 * Kademeli ve baglama duyarli item tavsiyesi.
 *
 *   1. Kucukten buyuge: Manta yerine once Yasha; Yasha alininca Manta.
 *   2. Sahip olunan / tamamlanan item (ve parcalari) tekrar onerilmez.
 *   3. Gec oyunda (20. dk+) ara parca ve kucuk item yok; hedef dogrudan.
 *   4. Rakibe gore kisisel erken itemler: Wand (cok buyu), Raindrop (ani
 *      buyu patlamasi) — hero planinda olmasa bile, rol ve saate bakarak.
 *   5. Oyun saati bilinmiyorsa eski davranis korunur.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlayerItemAdvice,
  buildTeamAnalysis,
} from "../src/live/item-advice.js";
import {
  LATE_GAME_SECONDS,
  isSmallItem,
  nextBuildStep,
  ownedWithComponents,
} from "../src/live/item-progression.js";

const MIN = 60;

/**
 * @param {string[]} heroes
 * @param {string} team
 */
function rows(heroes, team) {
  return heroes.map((hero, index) => ({ hero, team, slot: index + 1 }));
}

/**
 * @param {Record<string, any>} options
 */
function advise(options) {
  return buildPlayerItemAdvice({
    allies: [],
    enemies: [],
    dataLevel: "self",
    minTotal: 8,
    ...options,
    player: { team: "radiant", items: [], backpack: [], ...options.player },
  });
}

const keysOf = (advice) => advice.map((row) => row.key);

test("sahip olunan itemin parcalari da elde sayilir", () => {
  const have = ownedWithComponents(["manta", "bloodthorn"]);
  assert.ok(have.has("yasha"));
  assert.ok(have.has("orchid"));
  assert.ok(have.has("blade_of_alacrity"), "parcalar ozyinelemeli acilir");
});

test("ara parca: Manta yerine once Yasha", () => {
  const step = nextBuildStep("manta", { have: new Set(), gameTime: 10 * MIN });
  assert.deepEqual(step, { key: "yasha", buildsInto: "manta" });

  const advice = advise({
    player: { hero: "bloodseeker" },
    gameTime: 10 * MIN,
  });
  const yasha = advice.find((row) => row.key === "yasha");
  assert.ok(yasha, "Manta'nin ara parcasi onerilmeli");
  assert.equal(yasha.buildsInto, "manta");
  assert.match(yasha.reason, /Manta/);
  assert.ok(!keysOf(advice).includes("manta"), "Manta henuz onerilmemeli");
});

test("Yasha alininca sira Manta'ya gelir", () => {
  const advice = advise({
    player: { hero: "bloodseeker", items: ["item_yasha"] },
    gameTime: 12 * MIN,
  });
  assert.ok(keysOf(advice).includes("manta"));
  assert.ok(!keysOf(advice).includes("yasha"));
});

test("tamamlanan item ve parcasi tekrar onerilmez", () => {
  const advice = advise({
    player: { hero: "bloodseeker", items: ["item_manta"] },
    gameTime: 15 * MIN,
  });
  assert.ok(!keysOf(advice).includes("manta"));
  assert.ok(!keysOf(advice).includes("yasha"));
});

test("birden fazla eksik ara parcada ucuzu once gelir", () => {
  // Abyssal Blade = Basher + Sange; Sange daha ucuz.
  const first = nextBuildStep("abyssal_blade", {
    have: new Set(),
    gameTime: 12 * MIN,
  });
  assert.equal(first.key, "sange");
  const second = nextBuildStep("abyssal_blade", {
    have: new Set(["sange"]),
    gameTime: 12 * MIN,
  });
  assert.equal(second.key, "basher");
  const done = nextBuildStep("abyssal_blade", {
    have: new Set(["sange", "basher"]),
    gameTime: 12 * MIN,
  });
  assert.deepEqual(done, { key: "abyssal_blade", buildsInto: null });
});

test("temel parcalar adim sayilmaz (Satanic -> Reaver onerilmez)", () => {
  const step = nextBuildStep("satanic", {
    have: new Set(),
    gameTime: 10 * MIN,
  });
  assert.deepEqual(step, { key: "satanic", buildsInto: null });
});

test("gec oyunda ara parca yok, hedef dogrudan onerilir", () => {
  const advice = advise({
    player: { hero: "bloodseeker" },
    gameTime: 30 * MIN,
  });
  assert.ok(keysOf(advice).includes("manta"));
  assert.ok(!keysOf(advice).includes("yasha"));
});

test("gec oyunda kucuk item onerilmez (planda olsa bile)", () => {
  assert.ok(isSmallItem("magic_wand"));
  const early = advise({
    player: { hero: "bloodseeker" },
    gameTime: 5 * MIN,
  });
  assert.ok(keysOf(early).includes("magic_wand"));

  const late = advise({
    player: { hero: "bloodseeker" },
    gameTime: LATE_GAME_SECONDS + MIN,
  });
  assert.ok(!keysOf(late).includes("magic_wand"));
});

test("elle eklenen item gec oyunda da oldugu gibi kalir", () => {
  const advice = advise({
    player: { hero: "bloodseeker" },
    gameTime: 35 * MIN,
    override: { add: ["magic_wand"] },
  });
  assert.equal(advice[0].key, "magic_wand");
});

test("oyun saati bilinmiyorsa eski davranis: plandaki item oldugu gibi", () => {
  const advice = advise({ player: { hero: "bloodseeker" } });
  assert.ok(keysOf(advice).includes("manta"));
  assert.ok(!keysOf(advice).includes("yasha"));
  assert.ok(keysOf(advice).includes("magic_wand"));
});

test("cok buyu kullanan rakibe karsi Wand planda olmasa da onerilir", () => {
  // Chaos Knight'in planinda Magic Wand yok.
  const input = {
    player: { hero: "chaos_knight" },
    enemies: rows(["skywrath_mage"], "dire"),
    dataLevel: "heroes",
  };
  const early = advise({ ...input, gameTime: 8 * MIN });
  const wand = early.find((row) => row.key === "magic_wand");
  assert.ok(wand, "Wand onerilmeli");
  assert.equal(wand.group, "counter");
  assert.match(wand.reason, /Skywrath/);

  const late = advise({ ...input, gameTime: 25 * MIN });
  assert.ok(!keysOf(late).includes("magic_wand"), "gec oyunda Wand yok");
});

test("rakipte buyu hero'su yoksa Wand eklenmez", () => {
  const advice = advise({
    player: { hero: "chaos_knight" },
    enemies: rows(["phantom_assassin"], "dire"),
    dataLevel: "heroes",
    gameTime: 8 * MIN,
  });
  assert.ok(!keysOf(advice).includes("magic_wand"));
});

test("Raindrop: mid hero'ya tek burst rakipte bile onerilir", () => {
  const advice = advise({
    player: { hero: "bloodseeker" },
    enemies: rows(["lina"], "dire"),
    dataLevel: "heroes",
    gameTime: 6 * MIN,
  });
  const raindrop = advice.find((row) => row.key === "infused_raindrop");
  assert.ok(raindrop);
  assert.match(raindrop.reason, /Lina/);
});

test("Raindrop: carry'ye yalnizca birden fazla burst rakip varsa", () => {
  // Kural hero'nun ROLUNE bakiyor; tohum veri duzenlendikce Chaos Knight'in
  // rolleri degisebilir, bu yuzden rol testte sabitlenir.
  const heroOverrides = { chaos_knight: { laneRoles: ["carry"] } };
  const single = advise({
    player: { hero: "chaos_knight" },
    enemies: rows(["lina"], "dire"),
    dataLevel: "heroes",
    gameTime: 6 * MIN,
    heroOverrides,
  });
  assert.ok(!keysOf(single).includes("infused_raindrop"));

  const double = advise({
    player: { hero: "chaos_knight" },
    enemies: rows(["lina", "zuus"], "dire"),
    dataLevel: "heroes",
    gameTime: 6 * MIN,
    heroOverrides,
  });
  assert.ok(keysOf(double).includes("infused_raindrop"));
});

test("30. dakikada Raindrop onerilmez", () => {
  const advice = advise({
    player: { hero: "bloodseeker" },
    enemies: rows(["lina", "zuus", "nevermore"], "dire"),
    dataLevel: "heroes",
    gameTime: 30 * MIN,
  });
  assert.ok(!keysOf(advice).includes("infused_raindrop"));
});

test("zaten elde olan erken item tekrar onerilmez", () => {
  const advice = advise({
    player: { hero: "chaos_knight", items: ["item_magic_wand"] },
    enemies: rows(["skywrath_mage"], "dire"),
    dataLevel: "heroes",
    gameTime: 8 * MIN,
  });
  assert.ok(!keysOf(advice).includes("magic_wand"));
});

test("kisisel erken itemler takim onerisine girmez", () => {
  const analysis = buildTeamAnalysis({
    allies: rows(["chaos_knight", "crystal_maiden"], "radiant"),
    enemies: rows(["lina", "zuus", "skywrath_mage"], "dire"),
    dataLevel: "heroes",
    myTeam: "radiant",
  });
  const keys = analysis.radiant.items.map((row) => row.key);
  assert.ok(!keys.includes("magic_wand"));
  assert.ok(!keys.includes("infused_raindrop"));
});
