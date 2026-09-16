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

import { isKnownHero, heroRecord } from "../src/heroes/hero-catalog.js";
import { HERO_TRAITS } from "../src/heroes/hero-traits.js";
import {
  buildPlayerItemAdvice,
  buildTeamAnalysis,
} from "../src/live/item-advice.js";
import { isRetiredItem } from "../src/live/item-keys.js";
import { THREATS, detectThreats, heroThreats } from "../src/live/threats.js";

/** @param {string[]} heroes */
const rows = (heroes, team) => heroes.map((hero) => ({ hero, team }));

/** Build parcasi olmayan, plan sarti aranmayan itemler (bkz. item-advice.js). */
const DETECTION_ITEMS = new Set(["dust", "gem", "essence_distiller"]);

/** Bir hero'nun planindaki tum itemler. */
const planOf = (hero) => {
  const record = heroRecord(hero);
  return new Set([...record.requiredItems, ...record.situationalItems]);
};

test("tohum ozellik listeleri kullanicinin saydigi hero'lari kapsar", () => {
  // Bu ornekler kullanicidan geldi; tohum liste degisirse burada patlamali.
  const expected = {
    invisible: [
      "riki",
      "weaver",
      "mirana",
      "bounty_hunter",
      "kez",
      "nyx_assassin",
    ],
    regen: ["huskar", "alchemist", "shredder", "necrolyte", "dawnbreaker"],
    escape: ["puck", "storm_spirit", "ember_spirit", "antimage", "kez"],
    magical: ["zuus", "leshrac", "skywrath_mage", "snapfire", "venomancer"],
    targeted: ["doom_bringer", "lina", "bane", "sniper", "vengefulspirit"],
    passive: [
      "bristleback",
      "phantom_assassin",
      "dragon_knight",
      "monkey_king",
    ],
    ranged: ["drow_ranger", "nevermore", "furion", "muerta", "arc_warden"],
    shield: ["abaddon", "templar_assassin", "oracle", "morphling"],
    armor: ["terrorblade", "skeleton_king", "slardar", "treant"],
    movespeed: ["bloodseeker", "spirit_breaker", "marci", "primal_beast"],
  };

  for (const [key, heroes] of Object.entries(expected)) {
    for (const hero of heroes) {
      assert.ok(
        heroThreats(hero).includes(key),
        hero + " icin '" + key + "' ozelligi tanimli degil",
      );
    }
  }
});

test("her ozellik tanimli bir hero'ya ve gecerli bir item'a baglidir", () => {
  for (const trait of HERO_TRAITS) {
    for (const hero of trait.heroes) {
      assert.ok(isKnownHero(hero), trait.key + " icin tanimsiz hero: " + hero);
    }
    for (const item of trait.items) {
      assert.ok(
        !isRetiredItem(item),
        trait.key + " oyundan kaldirilmis item oneriyor: " + item,
      );
    }
  }
});

test("kullanici bir hero'ya ozellik EKLEYEBILIR", () => {
  // Kullanicinin somut istegi: Kez gorunmez oluyor ama tohum listede yoktu.
  // Kutucuk isaretlendiginde ayni hero dedektor onerisi uretmeli.
  const overrides = { treant: { traits: ["invisible", "armor"] } };

  assert.ok(heroThreats("treant", overrides).includes("invisible"));

  const found = detectThreats(rows(["treant"], "dire"), overrides);
  const invisible = found.find((row) => row.key === "invisible");
  assert.ok(invisible, "isaretlenen ozellik tehdit uretmeli");
  assert.deepEqual(invisible.heroes, ["treant"]);
});

test("kullanici bir hero'dan ozellik KALDIRABILIR", () => {
  // Bos liste "bu hero hicbir ozellik tasimiyor" demek; kayit silinmis
  // sayilmamali, yoksa kutucugu bosaltmanin hicbir etkisi olmazdi.
  const overrides = { riki: { traits: [] } };

  assert.deepEqual(heroThreats("riki", overrides), []);
  assert.deepEqual(detectThreats(rows(["riki"], "dire"), overrides), []);
});

test("ozellik duzenlemesi takim onerisini degistirir", () => {
  // Juggernaut'un planinda Silver Edge var; rakipte "guclu pasif" isaretli
  // bir hero yoksa onerilmemeli, isaretlenince onerilmeli.
  const allies = rows(["juggernaut"], "dire");
  const enemies = rows(["crystal_maiden"], "radiant");
  assert.ok(planOf("juggernaut").has("silver_edge"));

  const itemsFor = (heroOverrides) =>
    buildTeamAnalysis({
      allies,
      enemies,
      dataLevel: "heroes",
      myTeam: "dire",
      heroOverrides,
    }).dire.items.map((row) => row.key);

  assert.ok(!itemsFor({}).includes("silver_edge"));
  assert.ok(
    itemsFor({ crystal_maiden: { traits: ["passive"] } }).includes(
      "silver_edge",
    ),
  );
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
    // Dedektorler muaf: build parcasi degiller, kimse planina yazmaz.
    if (DETECTION_ITEMS.has(item.key)) {
      continue;
    }
    for (const hero of item.buyers) {
      assert.ok(
        planOf(hero).has(item.key),
        item.key + " " + hero + " planinda yok",
      );
    }
  }
});

test("gorunmez rakip, plan sarti olmadan dedektor onerir", () => {
  // Kullanicinin en temel ornegi: rakipte Riki varsa takim Distiller/dust
  // almali. Dust hicbir hero'nun item planinda gecmiyor; "planinda olan biri
  // olsun" sarti buna da uygulandiginda oneri sessizce kayboluyordu.
  const analysis = buildTeamAnalysis({
    allies: rows(["juggernaut", "crystal_maiden"], "dire"),
    enemies: rows(["riki"], "radiant"),
    dataLevel: "heroes",
    myTeam: "dire",
  });

  const keys = analysis.dire.items.map((row) => row.key);
  assert.ok(keys.includes("essence_distiller"));
  assert.ok(keys.includes("dust"));

  // Alici DESTEGE yazilir; dedektoru carry'nin almasi beklenmiyor.
  const dust = analysis.dire.items.find((row) => row.key === "dust");
  assert.deepEqual(dust.buyers, ["crystal_maiden"]);

  // Gorunmez isareti kaldirilinca oneri de gitmeli.
  const cleared = buildTeamAnalysis({
    allies: rows(["juggernaut", "crystal_maiden"], "dire"),
    enemies: rows(["riki"], "radiant"),
    dataLevel: "heroes",
    myTeam: "dire",
    heroOverrides: { riki: { traits: [] } },
  });
  assert.ok(!cleared.dire.items.some((row) => row.key === "dust"));
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
      {
        hero: "crystal_maiden",
        team: "dire",
        items: ["mekansm"],
        backpack: [],
      },
    ],
    enemies: rows(["zuus", "leshrac"], "radiant"),
    dataLevel: "full",
    myTeam: "dire",
  });

  assert.ok(!analysis.dire.items.some((row) => row.key === "mekansm"));
});
