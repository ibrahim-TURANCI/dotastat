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
  isRetiredItem,
  itemDisplayName,
  itemIconUrl,
  normalizeItemKey,
  ownedItems,
  resolveDataLevel,
  teamRoleBars,
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

test("rakip hero'lar bilindiginde oneri sayisi artar", () => {
  const advice = buildPlayerItemAdvice({
    player: gsiRow("juggernaut"),
    allies: [],
    enemies: [overwolfRow("abaddon")],
    dataLevel: "heroes",
  });

  assert.ok(advice.length > 2, "veri arttikca oneri sayisi da artmali");
});

test("rakip, hero'nun KENDI planindaki cevabi karsi hamleye cevirir", () => {
  // Juggernaut'un durumsal planinda Silver Edge var. Rakipte pasifi guclu bir
  // hero oldugunda o item "duruma gore" olmaktan cikip gerekcesiyle basa gecer.
  //
  // Onemli olan ne EKLENDIGI degil, neyin SIRALANDIGI: rakip hicbir zaman
  // hero'nun planinda olmayan bir itemi havuza sokmaz.
  const advice = buildPlayerItemAdvice({
    player: gsiRow("juggernaut"),
    allies: [],
    enemies: [overwolfRow("bristleback"), overwolfRow("phantom_assassin")],
    dataLevel: "heroes",
  });

  const silverEdge = advice.find((row) => row.key === "silver_edge");
  assert.ok(silverEdge, "plandaki cevap itemi onerilmeli");
  assert.equal(silverEdge.group, "counter");
  assert.match(silverEdge.reason, /pasifi güçlü/);
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
  // Eksen adlari radar ile ortak: tabloda gorunen yuzde ile analizde kullanilan
  // puan ayni alandan gelmeli (bkz. hero-catalog.js -> ROLE_VALUE_KEYS).
  assert.ok(analysis.scores.ours.durability > analysis.scores.theirs.durability);
  assert.ok(analysis.advantages.length > 0);
});

test("takim analizi iki taraf icin de simetrik uretilir", () => {
  const analysis = buildTeamAnalysis({
    allies: [gsiRow("abaddon"), gsiRow("axe"), gsiRow("tidehunter")],
    enemies: [
      overwolfRow("crystal_maiden"),
      overwolfRow("lion"),
      overwolfRow("sniper"),
    ],
    dataLevel: "heroes",
    myTeam: "radiant",
  });

  // Ekran Radiant ve Dire'yi yan yana ciziyor; hangi tarafta oldugumuza gore
  // sutunlarin yer degistirmemesi icin iki taraf da adiyla donmeli.
  assert.deepEqual(analysis.radiant.bars, analysis.scores.ours);
  assert.deepEqual(analysis.dire.bars, analysis.scores.theirs);
  assert.ok(analysis.radiant.advantages.length > 0);
  assert.ok(analysis.radarAxes.length === 6);
  assert.ok(analysis.tableRows.length === 8);
});

test("myTeam dire ise taraflar yer degistirir, sayilar degismez", () => {
  const rows = {
    allies: [gsiRow("axe"), gsiRow("tidehunter")],
    enemies: [overwolfRow("sniper"), overwolfRow("lion")],
    dataLevel: "heroes",
  };
  const asRadiant = buildTeamAnalysis({ ...rows, myTeam: "radiant" });
  const asDire = buildTeamAnalysis({ ...rows, myTeam: "dire" });

  assert.deepEqual(asDire.dire.bars, asRadiant.radiant.bars);
  assert.deepEqual(asDire.radiant.bars, asRadiant.dire.bars);
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

test("konusma dilindeki item anahtarlari gercek Dota anahtarina cevrilir", () => {
  // Bu anahtarlar hero planlarinda gecen yazimlar; ikon adresi dogrudan
  // anahtardan uretildigi icin cevrilmedikleri surece resim 404 donuyordu.
  const pairs = [
    ["khanda", "angels_demise", "Khanda"],
    ["battle_fury", "bfury", "Battle Fury"],
    ["boots_of_travel", "travel_boots", "Boots of Travel"],
    ["euls", "cyclone", "Eul's Scepter of Divinity"],
    ["linkensphere", "sphere", "Linken's Sphere"],
    ["drum_of_endurance", "ancient_janggo", "Drum of Endurance"],
    ["gleipnir", "gungir", "Gleipnir"],
    ["parasma", "devastator", "Parasma"],
    ["daedalus", "greater_crit", "Daedalus"],
    ["scythe_of_vyse", "sheepstick", "Scythe of Vyse"],
    ["ghost_scepter", "ghost", "Ghost Scepter"],
    ["aghanims_scepter", "ultimate_scepter", "Aghanim's Scepter"],
  ];

  for (const [written, real, label] of pairs) {
    assert.equal(normalizeItemKey(written), real, written);
    assert.equal(itemDisplayName(written), label, written);
    assert.ok(
      itemIconUrl(written).endsWith("/" + real + ".png"),
      written + " ikonu gercek dosya adini kullanmali",
    );
  }
});

test("oyundan kaldirilmis item hicbir zaman onerilmez", () => {
  assert.equal(isRetiredItem("necronomicon"), true);
  assert.equal(isRetiredItem("ring_of_aquila"), true);
  assert.equal(isRetiredItem("black_king_bar"), false);

  // Elle eklense bile: kayit eski olabilir, ama item artik dukkanda yok.
  const advice = buildPlayerItemAdvice({
    player: gsiRow("abaddon"),
    allies: [],
    enemies: [],
    dataLevel: "self",
    override: { add: ["necronomicon"] },
  });
  assert.ok(!advice.some((row) => row.key === "necronomicon"));

  // Takim onerisi de ayni kurala tabi.
  const analysis = buildTeamAnalysis({
    allies: [gsiRow("axe")],
    enemies: [overwolfRow("sniper")],
    dataLevel: "heroes",
  });
  const keys = [
    ...analysis.radiant.items,
    ...analysis.dire.items,
  ].map((row) => row.key);
  assert.ok(!keys.some((key) => isRetiredItem(key)));
});

test("hero-profiles'ta olmayan heroler de tavsiye ve radar uretir", () => {
  // Shadow Fiend, Pudge, Lina gibi 28 hero eski profil dosyasinda yoktu;
  // canli macta hic tavsiye almiyor ve takim radarina HIC katilmiyorlardi.
  for (const hero of ["nevermore", "pudge", "lina", "rubick", "kez"]) {
    const advice = buildPlayerItemAdvice({
      player: gsiRow(hero),
      allies: [],
      enemies: [],
      dataLevel: "self",
    });
    assert.ok(advice.length > 0, hero + " icin oneri uretilmedi");
  }

  const bars = teamRoleBars([gsiRow("nevermore"), gsiRow("pudge")]);
  assert.ok(
    Object.values(bars).some((value) => value > 0),
    "profilsiz heroler radara katilmali",
  );
});
