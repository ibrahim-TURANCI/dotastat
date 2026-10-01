/**
 * "Tavsiyeleri yönet" varsayilani.
 *
 * Korunan kurallar:
 *   - "Duzenlenmis" sayisi, gecerli duzenlemenin VARSAYILANDAN farkidir.
 *   - Varsayilani yalnizca catalogAdmin isaretli oyuncu kaydedebilir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  changesHeroSeed,
  editedHeroKeys,
  heroSeed,
  sameHeroOverride,
} from "../src/heroes/hero-catalog.js";
import { isCatalogAdmin, listRoster } from "../src/players/roster.js";

test("varsayilan yokken her duzenleme 'duzenlenmis' sayilir", () => {
  const plans = {
    pudge: { laneRoles: ["offlane"] },
    lion: { requiredItems: ["blink"] },
  };
  assert.deepEqual(editedHeroKeys(plans, {}), ["lion", "pudge"]);
});

test("varsayilan kaydedilince isaretler sifirlanir, yeni duzenleme gorunur", () => {
  const plans = {
    pudge: { laneRoles: ["offlane"] },
    lion: { requiredItems: ["blink"] },
  };
  // "Varsayılan olarak kaydet": varsayilan = gecerli duzenlemeler.
  const defaults = { ...plans };
  assert.deepEqual(editedHeroKeys(plans, defaults), []);

  // Sonraki duzenleme (degisen hero ve yeni hero) yeniden gorunur.
  const next = {
    ...plans,
    pudge: { laneRoles: ["offlane", "sup5"] },
    axe: { counterItems: ["force_staff"] },
  };
  assert.deepEqual(editedHeroKeys(next, defaults), ["axe", "pudge"]);

  // Varsayilandaki bir duzenlemenin kaldirilmasi da degisikliktir.
  const { lion, ...withoutLion } = plans;
  assert.ok(lion);
  assert.deepEqual(editedHeroKeys(withoutLion, defaults), ["lion"]);
});

test("ayni duzenleme alan sirasindan bagimsiz esit sayilir", () => {
  assert.equal(
    sameHeroOverride(
      { laneRoles: ["offlane"], requiredItems: ["blink"] },
      { requiredItems: ["blink"], laneRoles: ["offlane"] },
    ),
    true,
  );
  // Liste sirasi plan sirasidir; fark sayilir.
  assert.equal(
    sameHeroOverride(
      { requiredItems: ["blink", "pipe"] },
      { requiredItems: ["pipe", "blink"] },
    ),
    false,
  );
});

test("koddaki varsayilanla ayni sonucu veren kayit duzenleme sayilmaz", () => {
  const seed = heroSeed("pudge");
  const { hero, ...sameAsSeed } = seed;
  assert.ok(hero);
  assert.equal(changesHeroSeed("pudge", sameAsSeed), false);
  assert.deepEqual(editedHeroKeys({ pudge: sameAsSeed }, {}), []);

  const changed = { ...sameAsSeed, removedItems: ["blink"] };
  assert.equal(changesHeroSeed("pudge", changed), true);
  assert.deepEqual(editedHeroKeys({ pudge: changed }, {}), ["pudge"]);
});

test("varsayilani yalnizca katalog yoneticisi kaydedebilir", () => {
  const admins = listRoster().filter((player) => player.catalogAdmin);
  assert.deepEqual(
    admins.map((player) => player.id),
    ["janissary"],
  );
  const janissary = admins[0];
  assert.equal(isCatalogAdmin(janissary.player_id), true);
  assert.equal(isCatalogAdmin("janissary"), true);

  const other = listRoster().find((player) => player.id !== "janissary");
  assert.equal(isCatalogAdmin(other.player_id), false);
  assert.equal(isCatalogAdmin("123"), false);
});
