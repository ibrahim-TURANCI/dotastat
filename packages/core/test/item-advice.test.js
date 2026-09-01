/**
 * Canli mac item tavsiyesi.
 *
 * Korunan sozlesme: tavsiye ELDEKI VERIYE gore olceklenir. Rakip hero'lari
 * gormeden counter onerisi uretmek, gormeden konusmaktir; bu yuzden veri
 * seviyesi dustukce oneri sayisi ve turu daralir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveItemAdvice,
  buildPlayerItemAdvice,
  buildTeamAnalysis,
  itemDisplayName,
  ownedItems,
  resolveDataLevel,
} from "../src/live/item-advice.js";

/** GSI satiri: envanteri BILINEN oyuncu. */
function gsiRow(hero, items = [], extra = {}) {
  return {
    hero,
    team: "radiant",
    items,
    backpack: [],
    neutral: "",
    ...extra,
  };
}

/** Overwolf satiri: yalnizca hero biliniyor, envanter YOK. */
function overwolfRow(hero, extra = {}) {
  return { hero, team: "dire", ...extra };
}

test("item adi tablodan cozulur, bilinmeyen anahtar gizlenmez", () => {
  assert.equal(itemDisplayName("black_king_bar"), "Black King Bar");
  assert.equal(itemDisplayName("item_blink"), "Blink Dagger");
  // Tabloda olmayan bir item yok sayilmamali; ham adiyla gorunmeli.
  assert.equal(itemDisplayName("yeni_item"), "Yeni Item");
  assert.equal(itemDisplayName(""), "");
});

test("sahip olunan itemler ana envanter + backpack + neutral", () => {
  const row = {
    items: ["blink", "item_black_king_bar"],
    backpack: ["tpscroll"],
    neutral: "trusty_shovel",
  };
  assert.deepEqual(ownedItems(row), [
    "blink",
    "black_king_bar",
    "tpscroll",
    "trusty_shovel",
  ]);
});

test("veri seviyesi: rakip hero yoksa 'self'", () => {
  assert.equal(resolveDataLevel([gsiRow("invoker")], []), "self");
});

test("veri seviyesi: rakip hero var envanter yoksa 'heroes'", () => {
  assert.equal(
    resolveDataLevel([gsiRow("invoker")], [overwolfRow("axe")]),
    "heroes",
  );
});

test("veri seviyesi: rakip envanteri de goruluyorsa 'full'", () => {
  assert.equal(
    resolveDataLevel(
      [gsiRow("invoker")],
      [{ hero: "axe", team: "dire", items: ["blink"] }],
    ),
    "full",
  );
});

test("yalnizca GSI varken 2 oneri verilir ve hepsi hero planindan gelir", () => {
  const advice = buildPlayerItemAdvice({
    player: gsiRow("invoker"),
    allies: [],
    enemies: [],
    dataLevel: "self",
  });

  assert.equal(advice.length, 2, "eksik veriyle az konusulmali");
  assert.ok(
    advice.every((row) => row.group === "core" || row.group === "situational"),
    "rakip bilinmeden counter onerilemez",
  );
});

test("rakip hero'lar bilindiginde counter onerisi acilir", () => {
  const advice = buildPlayerItemAdvice({
    player: gsiRow("juggernaut"),
    allies: [],
    // Abaddon'un counterItems listesi heavens_halberd / lotus_orb gibi
    // itemleri tasir; rakip bilindiginde bunlar devreye girmeli.
    enemies: [overwolfRow("abaddon")],
    dataLevel: "heroes",
  });

  assert.ok(advice.length > 2, "veri arttikca oneri sayisi da artmali");
  assert.ok(
    advice.some((row) => row.group === "counter"),
    "rakip hero'ya karsi item onerilmeli",
  );
});

test("sahip olunan item tekrar onerilmez", () => {
  const withoutItem = buildPlayerItemAdvice({
    player: gsiRow("abaddon"),
    allies: [],
    enemies: [],
    dataLevel: "self",
  });
  const first = withoutItem[0].key;

  const withItem = buildPlayerItemAdvice({
    player: gsiRow("abaddon", [first]),
    allies: [],
    enemies: [],
    dataLevel: "self",
  });

  assert.ok(
    !withItem.some((row) => row.key === first),
    "elde olan item onerilmemeli",
  );
});

test("elle eklenen item en one gelir, elle cikarilan hic gorunmez", () => {
  const base = buildPlayerItemAdvice({
    player: gsiRow("abaddon"),
    allies: [],
    enemies: [],
    dataLevel: "self",
  });
  const removedKey = base[0].key;

  const advice = buildPlayerItemAdvice({
    player: gsiRow("abaddon"),
    allies: [],
    enemies: [],
    dataLevel: "self",
    override: { add: ["radiance"], remove: [removedKey] },
  });

  assert.equal(advice[0].key, "radiance", "elle eklenen once gelmeli");
  assert.equal(advice[0].reason, "Elle eklendi.");
  assert.ok(!advice.some((row) => row.key === removedKey));
});

test("aura item takimda tek kisiye onerilir", () => {
  const result = buildLiveItemAdvice({
    // Ayni hero'dan bes tane: kural olmasa hepsine ayni aura item gelirdi.
    radiantPlayers: Array.from({ length: 5 }, () => gsiRow("abaddon")),
    direPlayers: [],
    myTeam: "radiant",
  });

  const unique = "crimson_guard";
  const count = result.radiantPlayers.filter((row) =>
    (row.itemAdvice || []).some((card) => card.key === unique),
  ).length;

  assert.ok(count <= 1, `aura item ${count} kisiye onerilmis`);
});

test("takim analizi: rakip gorunmuyorsa karsilastirma yapilmaz", () => {
  const analysis = buildTeamAnalysis({
    allies: [gsiRow("abaddon"), gsiRow("crystal_maiden")],
    enemies: [],
    dataLevel: "self",
  });

  assert.equal(analysis.comparable, false);
  assert.equal(analysis.advantages.length, 0);
  assert.match(analysis.note, /Overwolf/);
});

test("takim analizi: rakip bilindiginde avantaj listesi cikar", () => {
  const analysis = buildTeamAnalysis({
    allies: [gsiRow("abaddon"), gsiRow("axe"), gsiRow("tidehunter")],
    enemies: [
      overwolfRow("crystal_maiden"),
      overwolfRow("lion"),
      overwolfRow("sniper"),
    ],
    dataLevel: "heroes",
  });

  assert.equal(analysis.comparable, true);
  assert.ok(analysis.scores.ours.durable > analysis.scores.theirs.durable);
  assert.ok(analysis.advantages.length > 0);
});

test("takim onerisi eksik ozellikten turer", () => {
  const analysis = buildTeamAnalysis({
    allies: [gsiRow("axe"), gsiRow("tidehunter")],
    enemies: [overwolfRow("sniper")],
    dataLevel: "heroes",
  });

  if (analysis.gaps.length) {
    assert.ok(analysis.recommendations.length > 0);
    assert.ok(analysis.recommendations.every((row) => row.name));
  }
});

test("tavsiye paketi iki takim icin de uretilir ve satirlari bozmaz", () => {
  const radiant = [gsiRow("invoker", ["blink"])];
  const dire = [overwolfRow("axe")];
  const result = buildLiveItemAdvice({
    radiantPlayers: radiant,
    direPlayers: dire,
    myTeam: "radiant",
  });

  assert.ok(Array.isArray(result.radiantPlayers[0].itemAdvice));
  assert.ok(Array.isArray(result.direPlayers[0].itemAdvice));
  // Girdi satirlari degistirilmemeli.
  assert.equal(radiant[0].itemAdvice, undefined);
  assert.equal(result.dataLevel, "heroes");
});
