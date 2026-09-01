/**
 * Canli mac baglaminin tavsiye ile birlestigi nokta.
 *
 * Iki sozlesme:
 *   1. Satirlara `itemAdvice`, baglama `teamAnalysis` eklenir.
 *   2. Elle duzenleme (Tavsiyeleri yonet) motorun onerisini ezer.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildLiveMatchContext } from "../src/gsi/match-context.js";

function liveState(overrides = {}) {
  return {
    matchId: "9200",
    phase: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
    updatedAt: new Date().toISOString(),
    radiantScore: 10,
    direScore: 8,
    radiantPlayers: [
      {
        steamId: "76561198000000001",
        team: "radiant",
        slot: 1,
        hero: "juggernaut",
        items: ["phase_boots"],
        backpack: [],
        neutral: "",
      },
    ],
    direPlayers: [{ team: "dire", slot: 1, hero: "abaddon" }],
    ...overrides,
  };
}

test("canli baglam satirlara item tavsiyesi ekler", () => {
  const context = buildLiveMatchContext({ liveState: liveState() });

  const row = context.radiantPlayers[0];
  assert.ok(Array.isArray(row.itemAdvice));
  assert.ok(row.itemAdvice.length > 0);
  // Rakip hero goruluyor ama envanteri gorunmuyor.
  assert.equal(context.itemAdviceLevel, "heroes");
});

test("canli baglam takim analizini uretir", () => {
  const context = buildLiveMatchContext({ liveState: liveState() });

  assert.ok(context.teamAnalysis);
  assert.equal(context.teamAnalysis.comparable, true);
  assert.ok(context.teamAnalysis.note);
});

test("elle duzenleme motorun onerisini ezer", () => {
  const base = buildLiveMatchContext({ liveState: liveState() });
  const suggested = base.radiantPlayers[0].itemAdvice[0].key;

  const edited = buildLiveMatchContext({
    liveState: liveState(),
    itemPlanOverrides: {
      juggernaut: { add: ["satanic"], remove: [suggested] },
    },
  });

  const keys = edited.radiantPlayers[0].itemAdvice.map((row) => row.key);
  assert.equal(keys[0], "satanic", "elle eklenen basa gelmeli");
  assert.ok(!keys.includes(suggested), "elle cikarilan gorunmemeli");
});

test("rakip hero yoksa tavsiye daralir", () => {
  const context = buildLiveMatchContext({
    liveState: liveState({ direPlayers: [] }),
  });

  assert.equal(context.itemAdviceLevel, "self");
  assert.ok(context.radiantPlayers[0].itemAdvice.length <= 2);
  assert.equal(context.teamAnalysis.comparable, false);
});
