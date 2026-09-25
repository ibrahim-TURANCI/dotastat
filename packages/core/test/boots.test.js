/**
 * Bot tavsiyesi.
 *
 * Korunan kurallar:
 *   - Oyuncuya ayni anda yalnizca TEK bir bot onerilir.
 *   - Elinde bot olan oyuncuya yalnizca O botun ust surumu onerilir
 *     (Tranquil -> Boots of Bearing, Arcane -> Guardian Greaves); Phase ya da
 *     Treads alana Arcane/Tranquil onerilmez.
 *   - Bot ailesi bilesen verisinden turer, liste yazilmaz.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPlayerItemAdvice } from "../src/live/item-advice.js";
import {
  heldBoots,
  isBootItem,
  isBootUpgradeOf,
} from "../src/live/item-progression.js";

/** @param {string[]} required @param {string[]} [situational] */
function advise(required, { items = [], situational = [], gameTime } = {}) {
  return buildPlayerItemAdvice({
    player: { hero: "lion", items, backpack: [] },
    allies: [],
    enemies: [],
    dataLevel: "self",
    heroOverrides: {
      lion: { requiredItems: required, situationalItems: situational },
    },
    minTotal: 6,
    gameTime,
  }).map((card) => card.buildsInto || card.key);
}

const BOOTS = [
  "arcane_boots",
  "tranquil_boots",
  "power_treads",
  "phase_boots",
  "travel_boots",
  "travel_boots_2",
  "guardian_greaves",
  "boots_of_bearing",
];

const bootsIn = (keys) => keys.filter((key) => BOOTS.includes(key));

test("bot ailesi bilesen verisinden taninir", () => {
  for (const key of BOOTS) {
    assert.equal(isBootItem(key), true, key);
  }
  assert.equal(isBootItem("blink"), false);
  assert.equal(isBootUpgradeOf("guardian_greaves", "arcane_boots"), true);
  assert.equal(isBootUpgradeOf("boots_of_bearing", "tranquil_boots"), true);
  assert.equal(isBootUpgradeOf("travel_boots", "power_treads"), false);
  assert.deepEqual(heldBoots(["arcane_boots", "boots", "blink"]), [
    "arcane_boots",
  ]);
});

test("planda birden fazla bot olsa da tek bot onerilir", () => {
  const advice = advise(
    ["arcane_boots", "power_treads", "blink", "glimmer_cape"],
    { situational: ["travel_boots", "force_staff"], gameTime: 5 * 60 },
  );
  assert.deepEqual(bootsIn(advice), ["arcane_boots"], advice.join(", "));
});

test("gec oyunda botu olmayana pahali bot (Travel) secilir", () => {
  const advice = advise(["arcane_boots", "blink", "glimmer_cape"], {
    situational: ["travel_boots", "force_staff"],
    gameTime: 30 * 60,
  });
  assert.deepEqual(bootsIn(advice), ["travel_boots"], advice.join(", "));
});

test("Phase/Treads alana Arcane ve Tranquil onerilmez", () => {
  for (const held of ["phase_boots", "power_treads"]) {
    const advice = advise(
      ["arcane_boots", "tranquil_boots", "travel_boots", "blink"],
      { items: [held], gameTime: 12 * 60 },
    );
    assert.deepEqual(bootsIn(advice), [], held + ": " + advice.join(", "));
  }
});

test("elindeki botun ust surumu onerilebilir", () => {
  const tranquil = advise(
    ["arcane_boots", "boots_of_bearing", "guardian_greaves", "blink"],
    { items: ["tranquil_boots"], gameTime: 25 * 60 },
  );
  assert.deepEqual(bootsIn(tranquil), ["boots_of_bearing"], tranquil.join());

  const arcane = advise(
    ["tranquil_boots", "boots_of_bearing", "guardian_greaves", "blink"],
    { items: ["arcane_boots"], gameTime: 25 * 60 },
  );
  assert.deepEqual(bootsIn(arcane), ["guardian_greaves"], arcane.join());
});

test("yalnizca Boots of Speed varsa her bot onun ust surumudur", () => {
  const advice = advise(["phase_boots", "power_treads", "blink"], {
    items: ["boots"],
    gameTime: 8 * 60,
  });
  assert.deepEqual(bootsIn(advice), ["phase_boots"], advice.join(", "));
});
