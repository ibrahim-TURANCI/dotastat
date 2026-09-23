/**
 * Mac detayi: on oyuncu, iki takim, herkes icin Performance Rank.
 *
 *   - On oyuncunun hepsine PR uretilir; hepsi macin ortalama seviyesinden
 *     degerlendirilir (madalya ya da profil PR'i kaydirmaz).
 *   - Her takimda her pozisyondan bir kisi; elle girilen pozisyon kesin.
 *   - Mac bir kez cekilir ve suresiz onbellege yazilir.
 *   - Kadronun oynamadigi bir mac icin kaynaga gidilmez.
 *   - Kaynak maci vermezse kisa sure tekrar denenmez.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildMatchDetailView } from "../src/players/match-detail.js";
import { createPlayerDataService } from "../src/players/player-data-service.js";
import { listRoster } from "../src/players/roster.js";

function createMemoryStorage() {
  const rows = new Map();
  return {
    rows,
    async get(key) {
      const row = rows.get(key);
      if (!row || (row.expiresAt && Date.now() > row.expiresAt)) {
        return null;
      }
      return row.value;
    },
    async set(key, value, options = {}) {
      rows.set(key, {
        value,
        expiresAt: options.ttlMs ? Date.now() + options.ttlMs : 0,
      });
    },
  };
}

/**
 * @param {number} slot
 * @param {Record<string, any>} [extra]
 */
function detailRow(slot, extra = {}) {
  const radiant = slot < 128;
  return {
    matchId: "777",
    playerId: "",
    accountId: "",
    personaName: "",
    slot,
    side: radiant ? "radiant" : "dire",
    hero: radiant ? "juggernaut" : "lina",
    role: radiant ? "pos1" : "pos2",
    result: radiant ? "win" : "loss",
    kills: 8,
    deaths: 4,
    assists: 10,
    gpm: 550,
    xpm: 600,
    heroDamage: 21000,
    heroHealing: 0,
    towerDamage: 3000,
    lastHits: 220,
    denies: 10,
    obsPlaced: null,
    senPlaced: null,
    campsStacked: null,
    teamKills: 40,
    teamDeaths: 25,
    durationSeconds: 2400,
    averageRankTier: 54,
    rankTier: 54,
    ...extra,
  };
}

function detail(rosterAccount) {
  return {
    matchId: "777",
    startedAt: "2026-09-01T00:00:00.000Z",
    durationSeconds: 2400,
    radiantWin: true,
    radiantScore: 40,
    direScore: 25,
    averageRankTier: 54,
    players: [
      detailRow(0, { accountId: rosterAccount }),
      detailRow(1, { personaName: "Yabanci" }),
      detailRow(2),
      detailRow(3),
      detailRow(4),
      detailRow(128),
      detailRow(129),
      detailRow(130),
      detailRow(131),
      detailRow(132),
    ],
    provider: "opendota",
  };
}

test("mac detayi: on oyuncunun hepsi PR alir, takimlar ayrilir", () => {
  const [member] = listRoster();
  const view = buildMatchDetailView({
    detail: detail(member.player_id),
    roster: listRoster(),
    forcedRolesByAccount: { [member.player_id]: "pos5" },
  });

  assert.equal(view.players.length, 10);
  assert.equal(view.players.filter((row) => row.side === "radiant").length, 5);
  assert.ok(view.players.every((row) => row.performanceRank > 0));

  // Her takimda her pozisyondan tam bir kisi.
  for (const side of ["radiant", "dire"]) {
    const roles = view.players
      .filter((row) => row.side === side)
      .map((row) => row.role)
      .sort();
    assert.deepEqual(roles, ["pos1", "pos2", "pos3", "pos4", "pos5"]);
  }

  const own = view.players.find((row) => row.rosterId === member.id);
  assert.equal(own.role, "pos5", "elle girilen pozisyon kesin");
  assert.equal(own.roleSource, "manual");
  assert.equal(own.name, member.name);

  const stranger = view.players.find((row) => row.slot === 1);
  assert.equal(stranger.name, "Yabanci");
  assert.equal(stranger.rosterId, "");
  assert.equal(view.players.find((row) => row.slot === 2).anonymous, true);
  assert.equal(stranger.heroDamage, 21000);
});

test("mac detayi: eksik veri hata vermez", () => {
  assert.equal(buildMatchDetailView({ detail: null }), null);
  assert.equal(buildMatchDetailView({ detail: { players: [] } }), null);
});

test("servis: mac bir kez cekilir, sonra onbellekten gelir", async () => {
  const [member] = listRoster();
  const storage = createMemoryStorage();
  await storage.set("matches:" + member.player_id + ":stale", {
    matches: [{ matchId: "777", hero: "juggernaut", result: "win" }],
    fetchedAt: new Date().toISOString(),
    schema: 99,
  });
  const service = createPlayerDataService({ storage });
  let calls = 0;
  service.client.getMatchDetail = async () => {
    calls += 1;
    return detail(member.player_id);
  };

  const first = await service.getMatchDetail("777");
  assert.equal(first.error, "");
  assert.equal(first.match.players.length, 10);
  assert.equal(first.fromCache, false);

  const second = await service.getMatchDetail("777");
  assert.equal(second.fromCache, true);
  assert.equal(calls, 1, "ikinci acilis kaynaga gitmemeli");
});

test("servis: kadronun oynamadigi mac icin kaynaga gidilmez", async () => {
  const service = createPlayerDataService({ storage: createMemoryStorage() });
  let calls = 0;
  service.client.getMatchDetail = async () => {
    calls += 1;
    return null;
  };
  const result = await service.getMatchDetail("123456");
  assert.equal(result.match, null);
  assert.equal(result.error, "mac-kadroda-degil");
  assert.equal(calls, 0);

  const invalid = await service.getMatchDetail("abc");
  assert.equal(invalid.error, "gecersiz-mac");
});

test("servis: kaynak maci vermezse kisa sure tekrar denenmez", async () => {
  const [member] = listRoster();
  const storage = createMemoryStorage();
  await storage.set("matches:" + member.player_id + ":stale", {
    matches: [{ matchId: "888", hero: "lina", result: "loss" }],
    fetchedAt: new Date().toISOString(),
    schema: 99,
  });
  const service = createPlayerDataService({ storage });
  let calls = 0;
  service.client.getMatchDetail = async () => {
    calls += 1;
    return null;
  };

  assert.equal((await service.getMatchDetail("888")).error, "mac-henuz-yok");
  assert.equal((await service.getMatchDetail("888")).error, "mac-henuz-yok");
  assert.equal(calls, 1);
});

test("mac detayi: PR madalyaya degil bu mactaki oyuna bagli", () => {
  // Ayni oyuncu, ayni istatistik; yalnizca madalyasi farkli (Archon 3 /
  // Divine 1). Mac ici karsilastirmada PR degismemeli.
  const withTier = (rankTier) => {
    const base = detail("");
    base.players[5] = detailRow(128, { rankTier });
    return buildMatchDetailView({ detail: base, roster: [] }).players.find(
      (row) => row.slot === 128,
    ).performanceRank;
  };
  assert.ok(withTier(43) > 0);
  assert.equal(withTier(43), withTier(71));
});

test("servis: mac seviyesi OpenDota'nin resmi ortalamasindan gelir", async () => {
  const [member] = listRoster();
  const storage = createMemoryStorage();
  // Oyuncunun mac listesinde resmi ortalama 55 (Legend 5); detaydaki
  // madalyalardan hesaplanan 54.
  await storage.set("matches:" + member.player_id + ":stale", {
    matches: [
      {
        matchId: "777",
        hero: "juggernaut",
        result: "win",
        averageRankTier: 55,
      },
    ],
    fetchedAt: new Date().toISOString(),
    schema: 99,
  });
  const service = createPlayerDataService({ storage });
  service.client.getMatchDetail = async () => detail(member.player_id);

  const result = await service.getMatchDetail("777");
  assert.equal(result.match.averageRankTier, 55);
  const own = result.match.players.find((row) => row.rosterId === member.id);
  // Aciklama tablodaki rolu soyler.
  assert.ok(own.summary.length > 0);
  assert.ok(
    own.summary.startsWith(own.role.replace("pos", "Pos ")),
    own.summary,
  );
});

test("yedek mac seviyesi madalyalarin MMR ortalamasindan", async () => {
  const { averageTierOf } = await import("../src/providers/opendota.js");
  // Ortanca kod 54 olurdu; MMR ortalamasi Legend 5'e denk geliyor.
  assert.equal(averageTierOf([54, 52, 62, 51, 64, 53, 54, 61, 64, 52]), 55);
  assert.equal(averageTierOf([]), null);
});
