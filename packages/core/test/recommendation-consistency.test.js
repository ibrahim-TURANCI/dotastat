/**
 * Tavsiye motorunun TUTARLILIK sozlesmeleri.
 *
 * Korunan kurallar:
 *   - Draft, pick bitene kadar bes pozisyonun hepsini gosterir; secilen
 *     hero'nun pozisyonu tahmin edilip bir blok gizlenmez.
 *   - Draft ve canli tavsiye rol/counter bilgisini AYNI katalogdan okur.
 *   - Oyuncunun bu mactaki pozisyonu biliniyorsa tavsiye ona gore uretilir.
 *   - Takimda tek kisinin almasi anlamli item rolu uyan oyuncuya gider ve
 *     takim arkadasinda zaten varsa baskasina onerilmez.
 *   - Katalogdaki rakip `counterItems` listesi tavsiyeye girer.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildDraftAdvice, heroSlots } from "../src/draft/draft-advisor.js";
import { scoreDraftPick } from "../src/draft/draft-analyzer.js";
import { applyOverwolfSnapshot } from "../src/gsi/merge-live.js";
import { normalizeGsiPayload } from "../src/gsi/normalize-gsi.js";
import { laneRoleOf } from "../src/heroes/hero-catalog.js";
import {
  buildLiveItemAdvice,
  buildPlayerItemAdvice,
  playerLaneRoles,
} from "../src/live/item-advice.js";
import { detectThreats } from "../src/live/threats.js";
import { ROLE_KEYS } from "../src/players/player-types.js";

// --- Draft -------------------------------------------------------------------

test("pick sirasinda bes pozisyonun hepsi gosterilir", () => {
  // Pudge pos3 icin alinmis olabilir; pos5 "dolu" sayilip gizlenmemeli.
  const advice = buildDraftAdvice({
    myTeam: "radiant",
    picks: [
      { hero: "pudge", team: "radiant" },
      { hero: "crystal_maiden", team: "radiant" },
      { hero: "lion", team: "dire" },
    ],
    phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
  });

  assert.deepEqual(
    advice.blocks.map((block) => block.role),
    ROLE_KEYS,
  );
  for (const block of advice.blocks) {
    assert.ok(block.suggestions.length > 0, block.role + " bos kalmamali");
  }
});

test("draft pozisyonlari katalogdan okur; kullanici duzenlemesi gecerlidir", () => {
  const overrides = { pudge: { laneRoles: ["offlane"] } };
  assert.deepEqual([...heroSlots("pudge", overrides)], ["pos3"]);

  const advice = buildDraftAdvice({
    myTeam: "radiant",
    picks: [{ hero: "axe", team: "radiant" }],
    phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
    heroOverrides: overrides,
    suggestionsPerRole: 200,
  });
  const where = advice.blocks
    .filter((block) => block.suggestions.some((row) => row.hero === "pudge"))
    .map((block) => block.role);
  assert.deepEqual(where, ["pos3"]);
});

test("draft counter bilgisini katalogdan okur", () => {
  const overrides = { lion: { counterHeroes: ["techies"] } };
  const advice = buildDraftAdvice({
    myTeam: "radiant",
    picks: [{ hero: "lion", team: "dire" }],
    phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
    heroOverrides: overrides,
    suggestionsPerRole: 200,
  });
  const techies = advice.blocks
    .flatMap((block) => block.suggestions)
    .find((row) => row.hero === "techies");
  assert.ok(techies, "techies aday olmali");
  assert.ok(
    techies.reasons.some((reason) => reason.includes("Lion için iyi cevap")),
    techies.reasons.join(" | "),
  );
});

test("combo puani bir kez sayilir ve iki yonde aranir", () => {
  // Magnus, profilinde Juggernaut'u combo olarak listeliyor.
  const forward = scoreDraftPick({
    candidateHero: "magnataur",
    teamHeroes: ["juggernaut"],
  });
  const reverse = scoreDraftPick({
    candidateHero: "juggernaut",
    teamHeroes: ["magnataur"],
  });
  for (const result of [forward, reverse]) {
    const combos = result.reasons.filter((reason) =>
      reason.startsWith("Combo"),
    );
    assert.equal(combos.length, 1, result.reasons.join(" | "));
  }

  const advice = buildDraftAdvice({
    myTeam: "radiant",
    picks: [{ hero: "juggernaut", team: "radiant" }],
    phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
    suggestionsPerRole: 200,
  });
  for (const row of advice.blocks.flatMap((block) => block.suggestions)) {
    const combos = row.reasons.filter((reason) => reason.startsWith("Combo"));
    assert.ok(combos.length <= 1, row.hero + ": " + row.reasons.join(" | "));
  }
});

// --- Canli veri ---------------------------------------------------------------

test("net worth gelmezse cepteki altin net worth sayilmaz", () => {
  const state = normalizeGsiPayload({
    map: {
      game_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
      clock_time: 60,
    },
    player: { steamid: "76561198000000001", team_name: "radiant", gold: 650 },
    hero: { name: "npc_dota_hero_axe" },
    items: {},
  });
  const me = [...state.radiantPlayers, ...state.direPlayers][0];
  assert.equal(me.gold, 650);
  assert.equal(me.netWorth, 0);
});

test("Overwolf pozisyonu oyuncu satirina tasinir", () => {
  const state = {
    matchId: "1",
    radiantPlayers: [],
    direPlayers: [],
    draft: { picks: [], bans: [] },
  };
  const snapshot = {
    matchId: "1",
    players: [
      { index: 0, team: "radiant", slot: 1, hero: "pudge", position: 3 },
    ],
    picks: [],
    bans: [],
  };
  const merged = applyOverwolfSnapshot(state, snapshot);
  assert.equal(merged.radiantPlayers[0].position, 3);
});

test("oyuncu rolu: once mactaki pozisyon, sonra kadro rolu, en son hero rolleri", () => {
  const record = { laneRoles: ["carry", "sup5"] };
  assert.equal(laneRoleOf(3), "offlane");
  assert.equal(laneRoleOf("pos4"), "sup4");
  assert.deepEqual(playerLaneRoles({ position: 3 }, record), ["offlane"]);
  assert.deepEqual(
    playerLaneRoles({ roster: { primaryRole: "pos5" } }, record),
    ["sup5"],
  );
  // Kadro rolu hero'ya uymuyorsa (Pudge mid oynanmiyor) hero rolleri kalir.
  assert.deepEqual(
    playerLaneRoles({ roster: { primaryRole: "pos2" } }, record),
    ["carry", "sup5"],
  );
  assert.deepEqual(playerLaneRoles({}, record), ["carry", "sup5"]);
});

// --- Item tavsiyesi ----------------------------------------------------------

test("takim arkadasinda olan tekil item baskasina onerilmez", () => {
  const overrides = { pudge: { requiredItems: ["pipe", "blink"] } };
  const result = buildLiveItemAdvice({
    radiantPlayers: [
      { hero: "axe", team: "radiant", items: ["pipe"], backpack: [] },
      { hero: "pudge", team: "radiant", items: [], backpack: [] },
    ],
    direPlayers: [],
    myTeam: "radiant",
    heroOverrides: overrides,
  });
  const pudge = result.radiantPlayers.find((row) => row.hero === "pudge");
  assert.ok(
    !pudge.itemAdvice.some((card) => card.key === "pipe"),
    pudge.itemAdvice.map((card) => card.key).join(", "),
  );
});

test("tekil destek itemi satir sirasina degil role gore dagitilir", () => {
  const overrides = {
    juggernaut: { requiredItems: ["mekansm", "manta"] },
    crystal_maiden: { requiredItems: ["mekansm", "glimmer_cape"] },
  };
  const result = buildLiveItemAdvice({
    // Carry ONCE geliyor; eskiden Mekansm'i o kapiyordu.
    radiantPlayers: [
      { hero: "juggernaut", team: "radiant", items: [], backpack: [] },
      { hero: "crystal_maiden", team: "radiant", items: [], backpack: [] },
    ],
    direPlayers: [],
    myTeam: "radiant",
    heroOverrides: overrides,
  });
  const has = (hero) =>
    result.radiantPlayers
      .find((row) => row.hero === hero)
      .itemAdvice.some((card) => card.key === "mekansm");
  assert.equal(has("crystal_maiden"), true);
  assert.equal(has("juggernaut"), false);
});

test("rakip hero'nun katalogdaki counterItems listesi tavsiyeye girer", () => {
  const overrides = {
    axe: { counterItems: ["glimmer_cape"] },
    lion: { requiredItems: ["blink", "aether_lens", "glimmer_cape"] },
  };
  const advice = buildPlayerItemAdvice({
    player: { hero: "lion", items: [], backpack: [] },
    allies: [],
    enemies: [{ hero: "axe" }],
    dataLevel: "heroes",
    heroOverrides: overrides,
  });
  const card = advice.find((row) => row.key === "glimmer_cape");
  assert.ok(card, advice.map((row) => row.key).join(", "));
  assert.equal(card.group, "counter");
  assert.match(card.reason, /Axe karşısında etkili/);
});

test("tehdit agirligi tasiyan hero sayisi ve net worth ile olceklenir", () => {
  const [single] = detectThreats([{ hero: "riki" }]).filter(
    (row) => row.key === "invisible",
  );
  const [double] = detectThreats([{ hero: "riki" }, { hero: "clinkz" }]).filter(
    (row) => row.key === "invisible",
  );
  assert.equal(single.weight, 1);
  assert.equal(double.weight, 2);

  // Takimin en zengini olan tasiyici, ortalamanin ustunde agirlik alir.
  const [fed] = detectThreats([
    { hero: "riki", netWorth: 20000 },
    { hero: "lion", netWorth: 5000 },
  ]).filter((row) => row.key === "invisible");
  assert.ok(fed.weight > 1, String(fed.weight));
});

test("oyun saati biliniyorsa cekirdek plan ucuzdan pahaliya okunur", () => {
  const overrides = {
    riki: { requiredItems: ["skadi", "diffusal_blade", "manta"] },
  };
  const advice = buildPlayerItemAdvice({
    player: { hero: "riki", items: [], backpack: [] },
    allies: [],
    enemies: [],
    dataLevel: "self",
    heroOverrides: overrides,
    gameTime: 30 * 60,
  });
  assert.equal(advice[0].key, "diffusal_blade");
});
