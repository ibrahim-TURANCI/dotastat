/**
 * Overwolf/DotaPlus log okumasi ve cok kaynakli canli mac birlestirmesi.
 *
 * Buradaki log satirlari GERCEK loglardan kopyalandi (27 Agustos - 1 Eylul
 * 2026). Bicim degisirse bu testler duser; sessizce bozulmaz.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOverwolfSnapshot,
  buildLiveMatchContext,
  buildOverwolfSnapshot,
  isLiveMatchActive,
  listRoster,
  isSnapshotForLiveState,
  mergeLiveStatesByMatch,
  normalizeGsiPayload,
  parseDotaPlusControllerLog,
  parseDotaPlusObjectLog,
} from "../src/index.js";

const PREFIX = "2026-08-29 14:20:13,001 (INFO) </6823.js> (:2) - ";

/** Gercek log satirlarinin kisaltilmis hali. */
function controllerLog(lines) {
  return lines.map((line) => PREFIX + line).join("\n");
}

/** Canli (oynanan) bir macin draft akisi. */
const LIVE_MATCH_LOG = controllerLog([
  "matchStore: [DD] Detected playing: 8972022536 dire",
  "matchStore: Detecting match 8972022536 - AllDraft - playing - ranked",
  "matchStore: Match state changed: DOTA_GAMERULES_STATE_HERO_SELECTION",
  'matchStore: [DD] Bans updated: [{"heroId":104,"team":0},{"heroId":14,"team":0}]',
  "matchStore: Hero picked: index: 0, isMe: false, id: 131, isTraversal: false, isDraftAssign: false, isAutoAssign: false",
  "matchStore: Hero picked: index: 5, isMe: false, id: 55, isTraversal: true, isDraftAssign: false, isAutoAssign: false",
  "matchStore: Hero picked: index: 5, isMe: false, id: 4, isTraversal: false, isDraftAssign: false, isAutoAssign: false",
  "matchStore: Hero picked: index: 6, isMe: true, id: 16, isTraversal: false, isDraftAssign: false, isAutoAssign: false",
]);

test("canli macta 10 slotun hero'su ve kendi slotumuz okunur", () => {
  const snapshot = parseDotaPlusControllerLog(LIVE_MATCH_LOG);

  assert.equal(snapshot.matchId, "8972022536");
  assert.equal(snapshot.activity, "playing");
  assert.equal(snapshot.myTeam, "dire");
  assert.equal(snapshot.mySlot, 6);
  assert.equal(snapshot.ranked, true);
  assert.equal(snapshot.matchState, "DOTA_GAMERULES_STATE_HERO_SELECTION");
  assert.equal(snapshot.bans.length, 2);

  const bySlot = Object.fromEntries(
    snapshot.picks.map((row) => [row.index, row.hero]),
  );
  assert.equal(bySlot[0], "ringmaster");
  assert.equal(bySlot[6], "sand_king");
  // index 0-4 Radiant, 5-9 Dire
  assert.equal(snapshot.picks.find((row) => row.index === 0).team, "radiant");
  assert.equal(snapshot.picks.find((row) => row.index === 6).team, "dire");
});

test("kilitlenmis secim, sonraki 'geziniyor' satiriyla silinmez", () => {
  const log = controllerLog([
    "matchStore: Detecting match 900 - AllDraft - playing - ranked",
    "matchStore: Hero picked: index: 3, isMe: false, id: 14, isTraversal: false, isDraftAssign: false, isAutoAssign: false",
    "matchStore: Hero picked: index: 3, isMe: false, id: 55, isTraversal: true, isDraftAssign: false, isAutoAssign: false",
  ]);

  const snapshot = parseDotaPlusControllerLog(log);
  const pick = snapshot.picks.find((row) => row.index === 3);
  assert.equal(pick.hero, "pudge");
  assert.equal(pick.confirmed, true);
});

test("log birden fazla mac icerirse en sonuncusu kullanilir", () => {
  const log = controllerLog([
    "matchStore: Detecting match 111 - AllDraft - playing - ranked",
    "matchStore: Hero picked: index: 0, isMe: false, id: 14, isTraversal: false, isDraftAssign: false, isAutoAssign: false",
    "matchStore: Match 111 ended. Winner is Dire",
    "matchStore: Detecting match 222 - AllDraft - playing - ranked",
    "matchStore: Hero picked: index: 1, isMe: false, id: 8, isTraversal: false, isDraftAssign: false, isAutoAssign: false",
  ]);

  const snapshot = parseDotaPlusControllerLog(log);
  assert.equal(snapshot.matchId, "222");
  assert.equal(snapshot.ended, false);
  assert.equal(snapshot.picks.length, 1);
  assert.equal(snapshot.picks[0].index, 1);
});

test("mac bitisi ve kazanan okunur", () => {
  const log = controllerLog([
    "matchStore: Detecting match 8972302495 - AllDraft - playing - ranked",
    "matchStore: Match 8972302495 ended. Winner is Dire",
  ]);

  const snapshot = parseDotaPlusControllerLog(log);
  assert.equal(snapshot.ended, true);
  assert.equal(snapshot.winner, "dire");
});

test("object logu her slotun rank'ini verir, simulasyon satirlari atlanir", () => {
  const roster = (matchId, rank, simulation) =>
    " 5 2026-08-29 14:20:13.5452 [INFO ] Roster " +
    JSON.stringify({
      heroPool: [],
      roster: [
        { playerIndex: 0, role: 5, steamId: "0", name: "", rank },
        { playerIndex: 6, role: 3, steamId: "201008262", name: "Me", rank: 53 },
      ],
      matchId,
      gameMode: "AllDraft",
      playerActivity: 0,
      partySteamIds: ["201008262", "1128333660"],
      isSimulation: simulation,
      isDebug: false,
      isRanked: true,
      amIRadiant: false,
    });

  const parsed = parseDotaPlusObjectLog(
    [roster("8972022536", 54, false), roster("999", 11, true)].join("\n"),
  );

  assert.equal(parsed.matchId, "8972022536");
  assert.equal(parsed.myTeam, "dire");
  assert.equal(parsed.activity, "playing");
  assert.deepEqual(parsed.partySteamIds, ["201008262", "1128333660"]);
  assert.equal(parsed.players[0].rank, 54);
  // Anonim slotta kimlik yoktur.
  assert.equal(parsed.players[0].accountId, "");
  assert.equal(parsed.players[1].accountId, "201008262");
});

test("iki log ayni maca aitse rank'lar hero'larla birlesir", () => {
  const objectText =
    " 5 2026-08-29 14:20:14.5452 [INFO ] Roster " +
    JSON.stringify({
      roster: [
        { playerIndex: 0, role: 5, steamId: "0", name: "", rank: 54 },
        { playerIndex: 6, role: 3, steamId: "0", name: "", rank: 72 },
      ],
      matchId: "8972022536",
      gameMode: "AllDraft",
      playerActivity: 0,
      partySteamIds: [],
      isSimulation: false,
      isRanked: true,
      amIRadiant: false,
    });

  const snapshot = buildOverwolfSnapshot({
    controllerText: LIVE_MATCH_LOG,
    objectText,
  });

  const slot0 = snapshot.players.find((row) => row.index === 0);
  assert.equal(slot0.hero, "ringmaster");
  assert.equal(slot0.rank, 54);
});

test("baska maca ait object logu rank yazmaz", () => {
  const objectText =
    " 5 2026-08-29 14:20:14.5452 [INFO ] Roster " +
    JSON.stringify({
      roster: [{ playerIndex: 0, role: 5, steamId: "0", name: "", rank: 54 }],
      matchId: "BASKA-MAC",
      playerActivity: 0,
      partySteamIds: [],
      isSimulation: false,
      isRanked: true,
      amIRadiant: true,
    });

  const snapshot = buildOverwolfSnapshot({
    controllerText: LIVE_MATCH_LOG,
    objectText,
  });

  const slot0 = snapshot.players.find((row) => row.index === 0);
  assert.equal(slot0.hero, "ringmaster");
  assert.equal(slot0.rank || 0, 0);
});

// --- GSI ile birlestirme ----------------------------------------------------

/** Canli macta GSI YALNIZCA kendi oyuncumuzu verir. */
function gsiStateOnlyMe() {
  return {
    matchId: "8972022536",
    phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
    gameTime: 0,
    radiantScore: 0,
    direScore: 0,
    radiantPlayers: [],
    direPlayers: [
      {
        steamId: "76561198161273990",
        accountId: "201008262",
        name: "Janissary",
        team: "dire",
        slot: 2,
        hero: "sand_king",
        kills: 3,
        deaths: 1,
        assists: 5,
        netWorth: 4200,
        items: ["blink"],
      },
    ],
    draft: { picks: [{ hero: "sand_king", team: "dire" }], bans: [] },
    localSteamId: "76561198161273990",
    updatedAt: new Date().toISOString(),
  };
}

test("Overwolf yoksa GSI durumu hic degismez", () => {
  const state = gsiStateOnlyMe();
  assert.equal(applyOverwolfSnapshot(state, null), state);
  assert.equal(applyOverwolfSnapshot(state, undefined), state);
  assert.equal(applyOverwolfSnapshot(state, { matchId: "" }), state);
});

test("baska maca ait goruntu uygulanmaz", () => {
  const state = gsiStateOnlyMe();
  const snapshot = buildOverwolfSnapshot({ controllerText: LIVE_MATCH_LOG });
  snapshot.matchId = "BASKA-MAC";

  assert.equal(isSnapshotForLiveState(state, snapshot), false);
  assert.equal(applyOverwolfSnapshot(state, snapshot), state);
});

test("Overwolf, GSI'nin goremedigi slotlari doldurur; kendi satirimiz bozulmaz", () => {
  const state = gsiStateOnlyMe();
  const snapshot = buildOverwolfSnapshot({ controllerText: LIVE_MATCH_LOG });
  const merged = applyOverwolfSnapshot(state, snapshot);

  // GSI yalnizca 1 oyuncu veriyordu; artik Overwolf'un gordugu slotlar da var.
  const all = [...merged.radiantPlayers, ...merged.direPlayers];
  assert.ok(all.length > 1);

  // Kendi satirimiz GSI detayini korur ve iki kaynagi da tasir.
  const me = all.find((row) => row.accountId === "201008262");
  assert.equal(me.hero, "sand_king");
  assert.equal(me.kills, 3);
  assert.equal(me.netWorth, 4200);
  assert.deepEqual(me.items, ["blink"]);
  assert.ok(me.sources.includes("gsi"));
  assert.ok(me.sources.includes("overwolf"));
  assert.equal(me.anonymous, false);

  // Rakip slot yalnizca Overwolf'tan gelir: hero var, kimlik yok.
  const enemy = merged.radiantPlayers.find((row) => row.hero === "ringmaster");
  assert.equal(enemy.source, "overwolf");
  assert.equal(enemy.anonymous, true);

  // Draft artik Overwolf'un gordugu tum pickleri tasir.
  assert.ok(merged.draft.picks.length >= 3);
  assert.equal(merged.draft.bans.length, 2);
  assert.equal(merged.overwolf.myTeam, "dire");
  assert.equal(merged.overwolf.mySlot, 6);
});

test("GSI'nin uydurdugu slot numarasi Overwolf'un gercek slotunu ezmez", () => {
  // Canli oynarken GSI `allplayers` gondermez; normalize katmani slotu
  // bilemedigi icin 1 yazar. Overwolf ise gercek slotu (index 6 -> 2) bilir.
  const state = gsiStateOnlyMe();
  state.direPlayers[0].slot = 1;

  const snapshot = buildOverwolfSnapshot({ controllerText: LIVE_MATCH_LOG });
  const merged = applyOverwolfSnapshot(state, snapshot);

  const me = merged.direPlayers.find((row) => row.accountId === "201008262");
  assert.equal(me.slot, 2);

  // Ayni takimda iki oyuncu ayni slota dusmemeli.
  const slots = merged.direPlayers.map((row) => row.slot);
  assert.equal(new Set(slots).size, slots.length);
});

// --- Mac izleme / kocluk ----------------------------------------------------

/**
 * Gercek bir olay (mac 8977224253, 1 Eylul 2026): kullanici maci KOCLUK
 * modunda izlerken GSI duz `player` blogunda IZLEYENIN kimligini, `hero`
 * blogunda ise O AN IZLENEN hero'yu gonderdi. Birlestirme hero uzerinden
 * calistigi icin izleyicinin adi Anti-Mage oynayan yabancinin uzerine yapisti.
 */
function watchingSnapshot() {
  const controllerText = controllerLog([
    "matchStore: [DD] Detected coaching: 8977224253",
    "matchStore: Detecting match 8977224253 - AllDraft - coaching - ranked",
    'matchStore: Roster: [{"steamId":"1824720807","name":"DANISITOROROSKII","pickConfirmed":true,"hero":"skywrath_mage","team":2,"role":16,"rank":54,"medal_name":"legend","medal_stars":4,"team_slot":0,"player_index":0,"position":5},{"steamId":"1041705551","name":"041muhamad","pickConfirmed":true,"hero":"antimage","team":2,"role":1,"rank":54,"medal_name":"","medal_stars":0,"team_slot":1,"player_index":1,"position":1},{"steamId":"1860360996","name":"alex-8344","pickConfirmed":true,"hero":"mirana","team":3,"role":1,"rank":53,"medal_name":"","medal_stars":0,"team_slot":0,"player_index":5,"position":1}]',
  ]);
  return buildOverwolfSnapshot({ controllerText });
}

/** Izlerken GSI'nin gonderdigi tek satir: KIMLIK bizim, HERO baskasinin. */
function gsiWhileWatching() {
  return {
    matchId: "8977224253",
    phase: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
    gameTime: 900,
    radiantScore: 10,
    direScore: 8,
    radiantPlayers: [
      {
        steamId: "76561198161273990",
        accountId: "201008262",
        name: "Janissary",
        team: "radiant",
        slot: 1,
        hero: "antimage",
        kills: 4,
        deaths: 1,
        assists: 6,
        netWorth: 9000,
      },
    ],
    direPlayers: [],
    draft: { picks: [], bans: [] },
    localSteamId: "76561198161273990",
    updatedAt: new Date().toISOString(),
  };
}

test("mac izlerken izleyicinin kimligi yabanci oyuncunun uzerine yapismaz", () => {
  const merged = applyOverwolfSnapshot(gsiWhileWatching(), watchingSnapshot());
  const all = [...merged.radiantPlayers, ...merged.direPlayers];

  // Anti-Mage'i oynayan kisi roster'daki kisidir, izleyen degil.
  const antimage = all.find((row) => row.hero === "antimage");
  assert.equal(antimage.accountId, "1041705551");
  assert.equal(antimage.name, "041muhamad");

  // Izleyicinin kimligi masaya HIC girmemeli.
  assert.equal(
    all.some((row) => row.accountId === "201008262"),
    false,
  );
  assert.equal(
    all.some((row) => row.name === "Janissary"),
    false,
  );

  // Tablo yalnizca Overwolf'un bildirdigi oyunculardan olusur; 11. satir yok.
  assert.equal(all.length, 3);
});

test("izlerken 'bizim taraf' Overwolf'un bildirdigi taraftir", () => {
  const snapshot = watchingSnapshot();
  snapshot.myTeam = "dire";
  const merged = applyOverwolfSnapshot(gsiWhileWatching(), snapshot);
  const context = buildLiveMatchContext({ liveState: merged });

  assert.equal(context.myTeam, "dire");
});

test("OYNARKEN kendi satirimiz ayiklanmaz", () => {
  // Ayni ayiklama oynarken calissaydi kendi KDA'miz ekrandan duserdi.
  const merged = applyOverwolfSnapshot(
    gsiStateOnlyMe(),
    buildOverwolfSnapshot({ controllerText: LIVE_MATCH_LOG }),
  );
  const me = [...merged.radiantPlayers, ...merged.direPlayers].find(
    (row) => row.accountId === "201008262",
  );
  assert.ok(me);
  assert.equal(me.kills, 3);
});

test("uc arkadas ayni macta: Overwolf'lu + iki GSI'ci tek tabloda toplanir", () => {
  const snapshot = buildOverwolfSnapshot({ controllerText: LIVE_MATCH_LOG });

  // 1. arkadas: DotaStat + Overwolf. Kendi detayi + 10 slotun hero'su.
  const withOverwolf = {
    ...applyOverwolfSnapshot(gsiStateOnlyMe(), snapshot),
    uploaderSteamId: "76561198161273990",
  };

  // 2. arkadas: yalnizca DotaStat (GSI). Sadece kendi blogunu gorur.
  const gsiOnly = {
    matchId: "8972022536",
    phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
    gameTime: 0,
    radiantScore: 0,
    direScore: 0,
    radiantPlayers: [
      {
        steamId: "76561198000000001",
        accountId: "40000001",
        name: "Arkadas",
        team: "radiant",
        slot: 1,
        hero: "ringmaster",
        kills: 7,
        deaths: 0,
        assists: 2,
        netWorth: 9100,
      },
    ],
    direPlayers: [],
    draft: { picks: [{ hero: "ringmaster", team: "radiant" }], bans: [] },
    uploaderSteamId: "76561198000000001",
    updatedAt: new Date().toISOString(),
  };

  const [merged] = mergeLiveStatesByMatch([withOverwolf, gsiOnly]);
  const all = [...merged.radiantPlayers, ...merged.direPlayers];

  // Overwolf'cunun satiri:
  const first = all.find((row) => row.accountId === "201008262");
  assert.equal(first.hero, "sand_king");
  assert.equal(first.kills, 3);

  // Yalnizca GSI'li arkadasin satiri — hero uzerinden Overwolf slotuyla
  // eslesti, yani kimligi ve KDA'si dogru slota oturdu.
  const second = all.find((row) => row.accountId === "40000001");
  assert.equal(second.hero, "ringmaster");
  assert.equal(second.kills, 7);
  assert.equal(second.team, "radiant");
  assert.equal(second.anonymous, false);

  // Ayni hero iki ayri satira bolunmemeli.
  const ringmasters = all.filter((row) => row.hero === "ringmaster");
  assert.equal(ringmasters.length, 1);

  // Overwolf baglami korunur, katkida bulunanlar sayilir.
  assert.equal(merged.overwolf.matchId, "8972022536");
  assert.equal(merged.uploaders.length, 2);
});

test("farkli maclardaki kayitlar birlestirilmez", () => {
  const now = new Date().toISOString();
  const a = {
    matchId: "1",
    radiantPlayers: [],
    direPlayers: [],
    updatedAt: now,
  };
  const b = {
    matchId: "2",
    radiantPlayers: [],
    direPlayers: [],
    updatedAt: now,
  };

  const merged = mergeLiveStatesByMatch([a, b]);
  assert.equal(merged.length, 2);
});

test("masaustu: arkadasin siteden gelen envanteri ve Overwolf iskeleti yerel duruma eklenir", async () => {
  const { mergeRemoteLiveState } = await import("../src/gsi/merge-live.js");
  const local = {
    matchId: "42",
    phase: "GAME_IN_PROGRESS",
    gameTime: 700,
    localSteamId: "76561198000000001",
    radiantPlayers: [
      {
        steamId: "76561198000000001",
        team: "radiant",
        slot: 1,
        hero: "axe",
        kills: 5,
        items: ["blink"],
      },
    ],
    direPlayers: [],
    draft: { picks: [{ hero: "axe", team: "radiant" }], bans: [] },
    overwolf: null,
  };
  const remote = {
    matchId: "42",
    gameTime: 690,
    uploaders: ["76561198000000002"],
    radiantPlayers: [
      {
        accountId: "",
        team: "radiant",
        slot: 1,
        hero: "axe",
        position: 3,
        source: "overwolf",
      },
      {
        accountId: "",
        team: "radiant",
        slot: 2,
        hero: "lion",
        position: 5,
        source: "overwolf",
      },
      {
        steamId: "76561198000000002",
        team: "radiant",
        slot: 1,
        hero: "lion",
        kills: 1,
        items: ["magic_wand"],
      },
    ],
    direPlayers: [
      { team: "dire", slot: 6, hero: "pudge", position: 4, source: "overwolf" },
    ],
    draft: {
      picks: [
        { hero: "axe", team: "radiant" },
        { hero: "lion", team: "radiant" },
        { hero: "pudge", team: "dire" },
      ],
      bans: [],
    },
    overwolf: { matchId: "42", myTeam: "dire", mySlot: 6 },
  };

  const merged = mergeRemoteLiveState(local, remote);
  assert.equal(merged.gameTime, 700, "ust duzey alanlar yerel kalir");
  assert.equal(merged.localSteamId, "76561198000000001");
  const axe = merged.radiantPlayers.find((row) => row.hero === "axe");
  const lion = merged.radiantPlayers.find((row) => row.hero === "lion");
  assert.deepEqual(axe.items, ["blink"]);
  assert.equal(axe.kills, 5);
  assert.equal(axe.position, 3, "arkadasin Overwolf pozisyonu gelir");
  assert.deepEqual(lion.items, ["magic_wand"]);
  assert.equal(lion.slot, 2, "Overwolf'un gercek slotu korunur");
  assert.equal(merged.radiantPlayers.length, 2);
  assert.equal(merged.direPlayers.length, 1);
  assert.equal(merged.draft.picks.length, 3);
  assert.equal(merged.overwolf.myTeam, "", "arkadasin tarafi bize tasinmaz");

  assert.equal(
    mergeRemoteLiveState(local, { ...remote, matchId: "99" }),
    local,
  );
  assert.equal(mergeRemoteLiveState(local, null), local);
});

test("mac bitince ana menu kaydi Overwolf ile 'canli' maca donusmez", () => {
  // Ana menu: GSI'da harita blogu yok. Overwolf hafizasinda biten mac duruyor.
  const menu = normalizeGsiPayload({
    player: { steamid: "76561198000000001" },
  });
  const snapshot = {
    matchId: "8972022536",
    activity: "playing",
    ended: false,
    players: [{ hero: "npc_dota_hero_axe", team: "radiant", slot: 0 }],
    picks: [{ hero: "npc_dota_hero_axe", team: "radiant", slot: 0 }],
    bans: [],
  };

  const enriched = applyOverwolfSnapshot(menu, snapshot);
  assert.equal(enriched, menu);
  assert.equal(isLiveMatchActive(enriched), false);

  // Eski masaustu surumu zenginlestirilmis kaydi gondermis olsa bile site
  // onu canli saymaz.
  const legacy = {
    ...menu,
    matchId: "8972022536",
    radiantPlayers: [{ hero: "axe", team: "radiant" }],
  };
  assert.equal(isLiveMatchActive(legacy), false);

  // Overwolf maci bitti diye isaretlediyse de canli degildir.
  assert.equal(
    isLiveMatchActive({
      ...legacy,
      phase: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
      overwolf: { ended: true },
    }),
    false,
  );
});

test("pick oncesi: baska macta olan online arkadas olasi oyuncu sayilmaz", () => {
  const [first, second] = listRoster().filter(
    (row) => row.dotaProfile?.primaryRole,
  );
  const context = buildLiveMatchContext({
    liveState: {
      matchId: "100",
      phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
      updatedAt: new Date().toISOString(),
      radiantPlayers: [],
      direPlayers: [],
      draft: { picks: [], bans: [] },
    },
    onlinePlayers: [
      { accountId: first.player_id, client: "site" },
      {
        accountId: second.player_id,
        client: "desktop",
        inGame: true,
        matchId: "999",
      },
    ],
  });
  const names = context.draftAdvice.blocks
    .filter((block) => block.player?.probable)
    .map((block) => block.player.name);
  assert.ok(!names.includes(second.name));
  assert.ok(context.draftAdvice.probablePlayerCount <= 1);
});

test("secilen pozisyon oyuncunun satirina ve draft'taki yerine yazilir", () => {
  const me = listRoster().find(
    (row) =>
      row.dotaProfile?.primaryRole && row.dotaProfile.primaryRole !== "pos4",
  );
  const friend = listRoster().find(
    (row) => row.id !== me.id && row.dotaProfile?.primaryRole,
  );
  const steamOf = (player) =>
    String(BigInt(player.player_id) + 76561197960265728n);
  const context = buildLiveMatchContext({
    liveState: {
      matchId: "200",
      phase: "DOTA_GAMERULES_STATE_HERO_SELECTION",
      updatedAt: new Date().toISOString(),
      uploaderSteamId: steamOf(me),
      // Arkadasin masaustu kurulumu kendi secimini gondermis.
      localRoles: { [friend.player_id]: "pos5" },
      radiantPlayers: [
        { steamId: steamOf(friend), team: "radiant", hero: "", slot: 1 },
      ],
      direPlayers: [],
      draft: { picks: [], bans: [] },
    },
    viewerSteamId: steamOf(me),
    viewerRole: "pos4",
  });

  // Izleyici tabloda yok ama maci kendisi yayinliyor: secimiyle eklenir.
  const blocks = context.draftAdvice.blocks;
  assert.equal(blocks.find((row) => row.role === "pos4").player?.id, me.id);
  // Arkadasin secimi kendi satirina yazilir; draft onu pos5'e koyar.
  assert.equal(context.radiantPlayers[0].position, 5);
  assert.equal(blocks.find((row) => row.role === "pos5").player?.id, friend.id);
});
