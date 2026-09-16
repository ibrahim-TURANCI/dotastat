/**
 * Hero tavsiye katalogu ("Tavsiyeleri yonet" ekraninin okudugu kayit).
 *
 * Korunan sozlesmeler:
 *   1. Katalog OYUNDAKI TUM hero'lari kapsar. Eksik kalan bir hero canli macta
 *      tavsiye alamaz ve takim radarina hic katilmaz — bes kisilik bir takim
 *      dort kisi uzerinden olculur.
 *   2. Kullanicinin duzenlemesi tohum verinin UZERINE biner ve yalnizca
 *      yazdigi alani degistirir; tek bir listeyi kaydetmek digerlerini
 *      silmemeli.
 *   3. Duzenleme, motorun urettigi tavsiyeye gercekten yansir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import heroIds from "../src/data/hero-ids.js";
import retiredItems from "../src/data/retired-items.js";
import {
  heroCatalog,
  heroKeys,
  heroPlansFromItemPlans,
  heroRecord,
  heroSeed,
  isKnownHero,
  normalizeHeroOverride,
  normalizeHeroPlans,
  LANE_ROLES,
  ROLE_VALUE_KEYS,
} from "../src/heroes/hero-catalog.js";
import {
  buildPlayerItemAdvice,
  teamRoleBars,
  WEAKNESS_ITEMS,
} from "../src/live/item-advice.js";
import { isRetiredItem } from "../src/live/item-keys.js";

test("katalog oyundaki tum hero'lari kapsar", () => {
  const keys = new Set(heroKeys());
  const missing = Object.values(heroIds)
    .map(String)
    .filter((hero) => !keys.has(hero));

  assert.deepEqual(missing, [], "katalogda olmayan hero kaldi");
});

test("her kayit radar ekseni ve item plani tasir", () => {
  for (const hero of heroKeys()) {
    const record = heroSeed(hero);
    for (const axis of ROLE_VALUE_KEYS) {
      assert.equal(
        typeof record.roleValues[axis],
        "number",
        hero + " -> " + axis,
      );
    }
    assert.ok(record.laneRoles.length, hero + " icin pozisyon yok");
    assert.ok(
      record.requiredItems.length || record.situationalItems.length,
      hero + " icin item plani yok",
    );
  }
});

test("duzenleme yalnizca yazilan alani ezer", () => {
  const seed = heroSeed("juggernaut");
  const record = heroRecord("juggernaut", { requiredItems: ["manta"] });

  assert.deepEqual(record.requiredItems, ["manta"]);
  // Dokunulmayan alanlar tohum veriden gelmeye devam etmeli.
  assert.deepEqual(record.situationalItems, seed.situationalItems);
  assert.deepEqual(record.counterItems, seed.counterItems);
  assert.deepEqual(record.roleValues, seed.roleValues);
  assert.equal(record.edited, true);
});

test("roleValues kismi yazilabilir, diger eksenler korunur", () => {
  const seed = heroSeed("axe");
  const record = heroRecord("axe", { roleValues: { carry: 90 } });

  assert.equal(record.roleValues.carry, 90);
  assert.equal(record.roleValues.durability, seed.roleValues.durability);
});

test("gecersiz girdi kayda giremez", () => {
  const clean = normalizeHeroOverride({
    laneRoles: ["carry", "uydurma-rol"],
    counterHeroes: ["axe", "var-olmayan-hero"],
    // Kaldirilmis item kayda hic girmemeli; yoksa motor onu her seferinde
    // yeniden elemek zorunda kalir ve ekranda "kaydettim ama gorunmuyor" olur.
    requiredItems: ["necronomicon", "black_king_bar", "ITEM_Blink"],
    roleValues: { carry: 900, burst: -5 },
  });

  assert.deepEqual(clean.laneRoles, ["carry"]);
  assert.deepEqual(clean.counterHeroes, ["axe"]);
  assert.deepEqual(clean.requiredItems, ["black_king_bar", "blink"]);
  assert.equal(clean.roleValues.carry, 100);
  assert.equal(clean.roleValues.burst, 0);
});

test("ozellik kutucuklari tohumdan gelir ve uzerine yazilabilir", () => {
  // Kutucuklar tehdit tablosunu besliyor (bkz. live/threats.js); kaydin
  // tohumu bu yuzden ekranda ISARETLI acilmali, yoksa kullanici her hero icin
  // en bastan isaretlemek zorunda kalir.
  assert.ok(heroSeed("riki").traits.includes("invisible"));

  const record = heroRecord("riki", { traits: ["armor"] });
  assert.deepEqual(record.traits, ["armor"]);
  // Ozellik yazmak item planina dokunmaz.
  assert.deepEqual(record.requiredItems, heroSeed("riki").requiredItems);

  // Kutucuklarin tiklanma sirasi kayda girmez: liste hep TANIM sirasinda.
  assert.deepEqual(
    normalizeHeroOverride({ traits: ["armor", "invisible", "uydurma"] }).traits,
    ["invisible", "armor"],
  );

  // Hepsini bosaltmak gecerli bir kayit: o hero artik tehdit uretmez.
  assert.deepEqual(heroRecord("riki", { traits: [] }).traits, []);
  assert.ok(normalizeHeroPlans({ riki: { traits: [] } }).riki);
});

test("tanimsiz hero kayda giremez", () => {
  assert.equal(isKnownHero("juggernaut"), true);
  assert.equal(isKnownHero("uydurma_hero"), false);
  assert.deepEqual(
    normalizeHeroPlans({ uydurma_hero: { laneRoles: ["mid"] } }),
    {},
  );
  // Bos bir duzenleme de kayda girmez: "duzenlenmis hero" sayaci yaniltici olur.
  assert.deepEqual(normalizeHeroPlans({ juggernaut: {} }), {});
});

test("duzenleme motorun onerisine yansir", () => {
  const player = {
    hero: "juggernaut",
    team: "radiant",
    items: [],
    backpack: [],
  };
  const overrides = {
    juggernaut: { requiredItems: ["radiance"], removedItems: ["manta"] },
  };

  const advice = buildPlayerItemAdvice({
    player,
    allies: [],
    enemies: [],
    dataLevel: "self",
    heroOverrides: overrides,
  });

  const keys = advice.map((row) => row.key);
  assert.ok(keys.includes("radiance"), "eklenen item onerilmeli");
  assert.ok(!keys.includes("manta"), "cikarilan item onerilmemeli");
});

test("duzenlenen radar degeri takim yuzdesini degistirir", () => {
  const rows = [{ hero: "axe" }];
  const before = teamRoleBars(rows);
  const after = teamRoleBars(rows, { axe: { roleValues: { carry: 100 } } });

  assert.ok(after.carry > before.carry, "radar duzenlemeyi gormeli");
  assert.equal(after.durability, before.durability);
});

test("eski ekle/cikar kaydi yeni sekle tasinir", () => {
  const seed = heroSeed("invoker");
  const plans = heroPlansFromItemPlans({
    invoker: { add: ["octarine_core"], remove: ["blink"] },
    // Bos kayit tasinmaz.
    axe: { add: [], remove: [] },
  });

  assert.ok(!plans.axe);
  assert.deepEqual(plans.invoker.removedItems, ["blink"]);
  // Elle eklenen basa gecer, hero'nun cekirdek plani ARKADA KALIR: yalnizca
  // eklenen yazilsaydi tasima islemi plani silerdi.
  assert.equal(plans.invoker.requiredItems[0], "octarine_core");
  assert.ok(
    seed.requiredItems.every((key) =>
      plans.invoker.requiredItems.includes(key),
    ),
    "tohum plan tasimada kaybolmamali",
  );
});

test("katalog her hero icin birlesik kayit doner", () => {
  const catalog = heroCatalog({ axe: { laneRoles: ["mid"] } });

  assert.equal(Object.keys(catalog).length, heroKeys().length);
  assert.deepEqual(catalog.axe.laneRoles, ["mid"]);
  assert.equal(catalog.axe.edited, true);
  assert.equal(catalog.juggernaut.edited, false);
  for (const role of catalog.juggernaut.laneRoles) {
    assert.ok(LANE_ROLES.includes(role));
  }
});

test("tohum verinin hicbir yerinde kaldirilmis item yok", () => {
  // Bu testin sebebi somut: Eternal Shroud 7.41'de oyundan kaldirildi, ama
  // tohum veride 30 ayri yerde duruyordu ve takim onerisinde gorunmeye devam
  // etti. Motor calisma aninda eliyor; bu test veriyi de temiz tutar, boylece
  // "neden bu item hic cikmiyor" diye aranmaz.
  const hits = [];
  for (const hero of heroKeys()) {
    const record = heroSeed(hero);
    for (const field of ["requiredItems", "situationalItems", "counterItems"]) {
      for (const key of record[field]) {
        if (isRetiredItem(key)) {
          hits.push(hero + "." + field + " -> " + key);
        }
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("takim onerisi havuzunda kaldirilmis item yok", () => {
  const retired = Object.values(WEAKNESS_ITEMS)
    .flat()
    .map(([key]) => key)
    .filter((key) => isRetiredItem(key));

  assert.deepEqual(retired, []);
});

test("kaldirilmis item listesi yamaya gore etiketli", () => {
  // Uretici (scripts/build-retired-items.mjs) her anahtari kaldirildigi yamayla
  // yaziyor; etiket kaybolursa listenin ne zaman tazelendigi izlenemez hale
  // gelir.
  for (const [key, patch] of Object.entries(retiredItems)) {
    assert.match(patch, /^\d+\.\d+[a-z]?$/, key + " icin yama etiketi bozuk");
  }
  assert.equal(isRetiredItem("eternal_shroud"), true, "7.41'de kaldirildi");
  assert.equal(isRetiredItem("cornucopia"), true, "7.41'de kaldirildi");
});
