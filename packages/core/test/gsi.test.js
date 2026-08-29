import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGsiPayload } from "../src/gsi/normalize-gsi.js";
import {
  buildLiveMatchContext,
  isLiveMatchFresh,
} from "../src/gsi/match-context.js";
import { listRoster } from "../src/players/roster.js";

/**
 * Ornek GSI payload'u. Roster'daki ilk iki oyuncu radiant tarafinda.
 */
function samplePayload() {
  const roster = listRoster();
  const steamOffset = 76561197960265728n;
  const steamIdOf = (player) => String(BigInt(player.player_id) + steamOffset);

  return {
    map: {
      matchid: "8123456789",
      game_state: "DOTA_GAMERULES_STATE_HERO_SELECTION",
      clock_time: 42,
      radiant_score: 0,
      dire_score: 0,
    },
    player: { steamid: steamIdOf(roster[0]), name: roster[0].name },
    draft: {
      team2: { pick: true, pick0_class: "npc_dota_hero_juggernaut" },
      team3: { pick0_class: "npc_dota_hero_lion" },
    },
    allplayers: {
      player0: {
        steamid: steamIdOf(roster[0]),
        accountid: roster[0].player_id,
        name: roster[0].name,
        team_name: "radiant",
        hero: { name: "npc_dota_hero_juggernaut", level: 3 },
        kills: 2,
        deaths: 1,
        assists: 4,
        net_worth: 2400,
        items: {
          slot0: { name: "item_tango" },
          neutral0: { name: "item_trusty_shovel" },
        },
      },
      player1: {
        steamid: steamIdOf(roster[1]),
        accountid: roster[1].player_id,
        name: roster[1].name,
        team_name: "radiant",
        // Hero henuz secilmedi: nesne gelir ama name bostur.
        hero: { name: "", level: 0 },
        items: {},
      },
      player5: {
        steamid: "76561198000000005",
        accountid: "999999",
        name: "Rakip",
        team_name: "dire",
        hero: { name: "npc_dota_hero_lion", level: 2 },
        items: {},
      },
    },
  };
}

test("GSI payload'u normalize edilir", () => {
  const state = normalizeGsiPayload(samplePayload());

  assert.equal(state.matchId, "8123456789");
  assert.equal(state.radiantPlayers.length, 2);
  assert.equal(state.direPlayers.length, 1);
  assert.equal(state.radiantPlayers[0].hero, "juggernaut");
  assert.equal(state.radiantPlayers[0].items[0], "tango");
  assert.equal(state.radiantPlayers[0].neutral, "trusty_shovel");
});

test("hero secilmemisse '[object Object]' uretilmez", () => {
  const state = normalizeGsiPayload(samplePayload());
  assert.equal(state.radiantPlayers[1].hero, "");
});

test("draft blogu takimlara gore ayrilir", () => {
  const state = normalizeGsiPayload(samplePayload());
  const radiantPicks = state.draft.picks.filter(
    (row) => row.team === "radiant",
  );
  const direPicks = state.draft.picks.filter((row) => row.team === "dire");

  assert.deepEqual(
    radiantPicks.map((row) => row.hero),
    ["juggernaut"],
  );
  assert.deepEqual(
    direPicks.map((row) => row.hero),
    ["lion"],
  );
  assert.equal(state.draft.activeTeam, "radiant");
});

test("canli mac baglami roster oyuncularini tanir", () => {
  const state = normalizeGsiPayload(samplePayload());
  const context = buildLiveMatchContext({ liveState: state });
  const roster = listRoster();

  assert.equal(context.active, true);
  assert.equal(context.myTeam, "radiant");
  assert.deepEqual(context.knownPlayerIds, [roster[0].id, roster[1].id]);
  assert.equal(context.radiantPlayers[0].roster?.name, roster[0].name);
  assert.equal(context.direPlayers[0].roster, null);
  assert.equal(context.draftAdvice.visible, true);
});

test("eski durum bayat sayilir", () => {
  const fresh = { updatedAt: new Date().toISOString() };
  const old = {
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  };

  assert.equal(isLiveMatchFresh(fresh), true);
  assert.equal(isLiveMatchFresh(old), false);
  assert.equal(isLiveMatchFresh(null), false);
});

test("mac izlerken takima gore ic ice gelen oyuncular okunur", () => {
  // Izleyici modunda GSI `allplayers` GONDERMEZ; player/hero/items bloklari
  // team2/team3 altinda ic ice gelir. Eskiden yalnizca duz (oynayan) bicim
  // taninmadigi icin ekranda tek bir "Local Player" satiri cikiyordu.
  const raw = {
    map: {
      name: "start",
      matchid: "123",
      clock_time: 1156,
      radiant_score: 8,
      dire_score: 16,
      game_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
    },
    player: {
      team2: {
        player0: { name: "Alpha", kills: 3, deaths: 2, assists: 7 },
        player1: { name: "Beta", kills: 1, deaths: 5, assists: 12 },
      },
      team3: {
        player5: { name: "Gamma", kills: 9, deaths: 1, assists: 4 },
      },
    },
    hero: {
      team2: {
        player0: { name: "npc_dota_hero_juggernaut", level: 16 },
        player1: { name: "npc_dota_hero_crystal_maiden", level: 12 },
      },
      team3: { player5: { name: "npc_dota_hero_antimage", level: 20 } },
    },
  };

  const out = normalizeGsiPayload(raw);

  assert.equal(out.radiantPlayers.length, 2);
  assert.equal(out.direPlayers.length, 1);
  assert.equal(out.radiantPlayers[0].name, "Alpha");
  assert.equal(out.radiantPlayers[0].hero, "juggernaut");
  assert.equal(out.radiantPlayers[0].level, 16);
  assert.equal(out.direPlayers[0].hero, "antimage");

  // "Local Player" yedegine DUSMEMELI.
  assert.ok(
    ![...out.radiantPlayers, ...out.direPlayers].some(
      (row) => row.name === "Local Player",
    ),
    "izleyici verisi varken yerel oyuncu yedegi kullanilmamali",
  );
});
