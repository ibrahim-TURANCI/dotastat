import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDraftAdvice,
  resolveDraftStage,
} from "../src/draft/draft-advisor.js";
import { listRoster } from "../src/players/roster.js";

/**
 * @param {string[]} radiant
 * @param {string[]} dire
 */
function picks(radiant, dire) {
  return [
    ...radiant.map((hero) => ({ hero, team: "radiant" })),
    ...dire.map((hero) => ({ hero, team: "dire" })),
  ];
}

test("pick yokken asama 'pre' olur", () => {
  assert.equal(
    resolveDraftStage({ picks: [], phase: "HERO_SELECTION" }),
    "pre",
  );
});

test("pick suruyorken asama 'active' olur", () => {
  const stage = resolveDraftStage({
    picks: picks(["juggernaut"], ["lion"]),
    phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
  });
  assert.equal(stage, "active");
});

test("10 pick tamamlaninca asistan gizlenir", () => {
  const all = picks(
    ["juggernaut", "lina", "axe", "lion", "sven"],
    ["pudge", "tiny", "riki", "venomancer", "omniknight"],
  );
  const advice = buildDraftAdvice({ myTeam: "radiant", picks: all });
  assert.equal(advice.stage, "complete");
  assert.equal(advice.visible, false);
  assert.equal(advice.reason, "picks-complete");
});

test("oyun basladiysa pick sayisi ne olursa olsun asistan gizlenir", () => {
  const advice = buildDraftAdvice({
    myTeam: "radiant",
    picks: picks(["juggernaut"], []),
    phase: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
  });
  assert.equal(advice.visible, false);
});

test("pick baslamadan once taninan oyuncunun havuzu one cikar", () => {
  const janissary = listRoster().find((row) => row.id === "janissary");
  assert.ok(janissary, "tohum veride janissary olmali");

  const advice = buildDraftAdvice({
    myTeam: "radiant",
    picks: [],
    phase: "HERO_SELECTION",
    knownPlayers: [{ player: janissary, team: "radiant" }],
  });

  assert.equal(advice.stage, "pre");
  assert.equal(advice.visible, true);

  const offlane = advice.blocks.find((row) => row.role === "pos3");
  assert.ok(offlane, "pos3 blogu uretilmeli");
  assert.equal(offlane.player?.id, "janissary");

  const suggested = offlane.suggestions.map((row) => row.hero);
  const signature = janissary.dotaProfile.signatureHeroes;
  assert.ok(
    suggested.some((hero) => signature.includes(hero)),
    "imza kahramanlardan biri onerilmeli, gelen: " + suggested.join(", "),
  );
});

test("banli ve secilmis kahramanlar oneri havuzundan cikar", () => {
  const advice = buildDraftAdvice({
    myTeam: "radiant",
    picks: picks(["juggernaut"], ["lion"]),
    bans: [{ hero: "tinker", team: "radiant" }],
    phase: "HERO_SELECTION",
  });

  const allSuggested = advice.blocks.flatMap((row) =>
    row.suggestions.map((suggestion) => suggestion.hero),
  );
  for (const blocked of ["juggernaut", "lion", "tinker"]) {
    assert.ok(!allSuggested.includes(blocked), blocked + " onerilmemeliydi");
  }
});

test("rakip pickleri oneri siralamasini degistirir", () => {
  const base = buildDraftAdvice({
    myTeam: "radiant",
    picks: picks(["juggernaut"], []),
    phase: "HERO_SELECTION",
  });
  const withEnemies = buildDraftAdvice({
    myTeam: "radiant",
    picks: picks(["juggernaut"], ["lion", "axe", "pudge"]),
    phase: "HERO_SELECTION",
  });

  const first = (advice, role) =>
    advice.blocks.find((row) => row.role === role)?.suggestions[0];

  const baseTop = first(base, "pos2");
  const enemyTop = first(withEnemies, "pos2");
  assert.ok(baseTop && enemyTop);
  assert.notEqual(
    baseTop.hero + ":" + baseTop.score,
    enemyTop.hero + ":" + enemyTop.score,
    "rakip pickleri skorlamayi etkilemeli",
  );
});
