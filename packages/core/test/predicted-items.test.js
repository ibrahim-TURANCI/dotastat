/**
 * Envanteri gorunmeyen hero'lar icin tahmini envanter.
 *
 * Korunan sozlesmeler:
 *   1. Tahmin GERCEK VERIYI EZMEZ. Envanteri gorunen satira tahmin yazilmaz ve
 *      tahmin, veri seviyesini ("rakip envanteri goruluyor") yukseltmez.
 *   2. Tahmin OYUN SAATIYLE buyur ve hicbir zaman hero'nun cekirdek planinin
 *      disina cikmaz.
 *   3. Tahmine dayanan oneri, GORULEN veriye dayanandan sonra gelir ve
 *      gerekcesinde "bekleniyor" der.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { heroRecord } from "../src/heroes/hero-catalog.js";
import { buildLiveItemAdvice } from "../src/live/item-advice.js";
import { itemBudget, predictInventory } from "../src/live/predicted-items.js";

const minutes = (value) => value * 60;

test("tahmin oyun saatiyle buyur ve plandan disari cikmaz", () => {
  const record = heroRecord("juggernaut");
  const plan = new Set(record.requiredItems);

  const early = predictInventory({ record, gameTime: minutes(10) });
  const mid = predictInventory({ record, gameTime: minutes(25) });
  const late = predictInventory({ record, gameTime: minutes(45) });

  assert.ok(early.length < mid.length, "tahmin zamanla artmali");
  assert.ok(mid.length <= late.length);
  for (const key of late) {
    assert.ok(plan.has(key), key + " cekirdek planda yok ama tahmin edildi");
  }

  // Mac basinda hicbir sey tamamlanmis sayilmaz: 0. dakikada butce yok.
  assert.deepEqual(predictInventory({ record, gameTime: 0 }), []);
});

test("tahmin ucuz itemden baslar, pahaliyi erken vermez", () => {
  // Plan ALIM SIRASINDA degil kullanim sikligina gore sirali: Riki'nin listesi
  // Skadi ile basliyor. Ilk N itemi almis saymak 10. dakikada Riki'ye Skadi
  // vermek olurdu.
  const riki = heroRecord("riki");
  assert.equal(riki.requiredItems[0], "skadi");
  assert.ok(
    !predictInventory({ record: riki, gameTime: minutes(10) }).includes(
      "skadi",
    ),
  );

  // Carry'nin ilk tamamladigi item, plandaki EN UCUZ olan.
  const jugg = heroRecord("juggernaut");
  const first = predictInventory({ record: jugg, gameTime: minutes(12) });
  assert.deepEqual(first, ["phase_boots"]);
});

test("destek ile carry ayni saatte ayni yerde degil", () => {
  // Duz bir "her N dakikada bir item" ikisini ayni kefeye koyardi.
  const carry = itemBudget(["carry"], minutes(25));
  const support = itemBudget(["sup5"], minutes(25));
  assert.ok(
    carry > support * 1.5,
    "carry butcesi destekten belirgin buyuk olmali",
  );
});

test("gercek envanter gorunen satira tahmin yazilmaz", () => {
  const out = buildLiveItemAdvice({
    radiantPlayers: [
      {
        hero: "juggernaut",
        team: "radiant",
        items: ["phase_boots"],
        backpack: [],
      },
      { hero: "crystal_maiden", team: "radiant" },
    ],
    direPlayers: [{ hero: "phantom_assassin", team: "dire" }],
    myTeam: "radiant",
    gameTime: minutes(30),
  });

  const jugg = out.radiantPlayers.find((row) => row.hero === "juggernaut");
  const cm = out.radiantPlayers.find((row) => row.hero === "crystal_maiden");
  assert.equal(
    jugg.predictedItems,
    undefined,
    "gorunen envanter tahminle doldurulmaz",
  );
  assert.ok(cm.predictedItems?.length, "gorunmeyen envanter tahmin edilmeli");
});

test("tahmin veri seviyesini yukseltmez", () => {
  // Tahmin, rakip envanterini GORDUGUMUZ anlamina gelmez: "full" seviyesi tam
  // kural setini aciyor ve oraya yalnizca gercek veriyle gecilir.
  const out = buildLiveItemAdvice({
    radiantPlayers: [
      { hero: "juggernaut", team: "radiant", items: [], backpack: [] },
    ],
    direPlayers: [{ hero: "phantom_assassin", team: "dire" }],
    myTeam: "radiant",
    gameTime: minutes(40),
  });
  assert.equal(out.dataLevel, "heroes");
});

test("tahmini envanter oneriyi ilerletir", () => {
  // Somut sikayet: envanteri gorunmeyen satirin onerisi macin basinda
  // donuyordu — 40. dakikada hala plandaki ilk item yaziyordu.
  const adviceAt = (gameTime) =>
    buildLiveItemAdvice({
      radiantPlayers: [{ hero: "tidehunter", team: "radiant" }],
      direPlayers: [{ hero: "phantom_assassin", team: "dire" }],
      myTeam: "radiant",
      gameTime,
    }).radiantPlayers[0].itemAdvice.map((row) => row.key);

  const early = adviceAt(minutes(8));
  const late = adviceAt(minutes(45));
  assert.notDeepEqual(early, late, "oneri oyun saatiyle ilerlemeli");

  // Gec oyunda tahminen alinmis olan item tekrar onerilmemeli.
  const predicted = predictInventory({
    record: heroRecord("tidehunter"),
    gameTime: minutes(45),
  });
  for (const key of predicted) {
    assert.ok(!late.includes(key), key + " tahminen alinmisken yine onerildi");
  }
});

test("tahmine dayanan gerekce kendini belli eder", () => {
  // Riki'nin planinda Nullifier ve Abyssal var; ikisi de BKB'nin cevabi.
  const out = buildLiveItemAdvice({
    radiantPlayers: [
      { hero: "riki", team: "radiant", items: [], backpack: [] },
    ],
    direPlayers: [{ hero: "phantom_assassin", team: "dire" }],
    myTeam: "radiant",
    gameTime: minutes(45),
  });

  const seen = buildLiveItemAdvice({
    radiantPlayers: [
      { hero: "riki", team: "radiant", items: [], backpack: [] },
    ],
    direPlayers: [
      {
        hero: "phantom_assassin",
        team: "dire",
        items: ["black_king_bar"],
        backpack: [],
      },
    ],
    myTeam: "radiant",
    gameTime: minutes(45),
  });

  const reasonFor = (result, key) =>
    result.radiantPlayers[0].itemAdvice.find((row) => row.key === key)
      ?.reason || "";

  // Gorulen esya kesin konusur, tahmin edilen "bekleniyor" der.
  assert.match(reasonFor(seen, "nullifier"), /Black King Bar var/);
  const predictedReasons = out.radiantPlayers[0].itemAdvice
    .map((row) => row.reason)
    .filter((reason) => /bekleniyor/.test(reason));
  for (const reason of predictedReasons) {
    assert.doesNotMatch(reason, / var\./, "tahmin kesin konusmamali");
  }
});
