/**
 * Takim bazli pozisyon dagilimi ve profilsiz oyuncunun PR tabani.
 *
 *   - Her takimda her pozisyondan TAM BIR kisi.
 *   - Elle girilen pozisyon kesin; kalanlar ona gore dagilir.
 *   - Farm sirasi, lane, ward ve item ipuclari kullanilir.
 *   - Profili olmayan oyuncunun tabani rankindan / mac seviyesinden gelir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMatchPlayer } from "../src/players/performance-evaluation-engine.js";
import { resolveRankTier } from "../src/players/player-types.js";
import { assignTeamRoles } from "../src/players/role-assignment.js";

/**
 * Parse edilmemis bir mac: lane ve ward yok, yalnizca farm.
 * Sven > Lina > Windranger > Mirana > Tusk.
 */
const team = [
  { id: "sven", hero: "sven", netWorth: 31870, lastHits: 455, gpm: 875 },
  { id: "lina", hero: "lina", netWorth: 25047, lastHits: 321, gpm: 663 },
  { id: "wr", hero: "windrunner", netWorth: 21134, lastHits: 271, gpm: 567 },
  { id: "mirana", hero: "mirana", netWorth: 13700, lastHits: 107, gpm: 386 },
  { id: "tusk", hero: "tusk", netWorth: 12847, lastHits: 41, gpm: 324 },
];

const rolesOf = (result) =>
  Object.fromEntries(Object.entries(result).map(([id, row]) => [id, row.role]));

test("her pozisyondan tam bir kisi", () => {
  const roles = rolesOf(assignTeamRoles(team));
  assert.deepEqual(Object.values(roles).sort(), [
    "pos1",
    "pos2",
    "pos3",
    "pos4",
    "pos5",
  ]);
  assert.equal(roles.sven, "pos1");
  assert.equal(roles.lina, "pos2");
  assert.ok(["pos4", "pos5"].includes(roles.tusk));
  assert.ok(["pos4", "pos5"].includes(roles.mirana));
});

test("elle girilen pozisyon kesin, kalanlar ona gore dagilir", () => {
  const result = assignTeamRoles(
    team.map((row) =>
      row.id === "mirana" ? { ...row, forcedRole: "pos5" } : row,
    ),
  );
  assert.equal(result.mirana.role, "pos5");
  assert.equal(result.mirana.source, "manual");
  assert.equal(result.tusk.role, "pos4", "iki pos 5 olmaz; kalan destek pos 4");
  assert.equal(result.tusk.source, "team");
});

test("lane bilgisi varsa mid oyuncusu pos 2 olur", () => {
  // Farm'a gore Windranger ikinci ama lane verisi mid'in Lina oldugunu soyluyor.
  const result = rolesOf(
    assignTeamRoles(
      team.map((row) =>
        row.id === "lina"
          ? { ...row, netWorth: 18000, laneRole: "pos2" }
          : row.id === "wr"
            ? { ...row, laneRole: "pos3" }
            : row,
      ),
    ),
  );
  assert.equal(result.lina, "pos2");
  assert.equal(result.wr, "pos3");
});

test("en cok ward diken destek pos 5 olur", () => {
  const result = rolesOf(
    assignTeamRoles(
      team.map((row) =>
        row.id === "mirana"
          ? { ...row, obsPlaced: 14, senPlaced: 10 }
          : row.id === "tusk"
            ? { ...row, obsPlaced: 3, senPlaced: 2 }
            : { ...row, obsPlaced: 0, senPlaced: 0 },
      ),
    ),
  );
  assert.equal(result.mirana, "pos5");
  assert.equal(result.tusk, "pos4");
});

test("cakisan elle girisler yok sayilir, yine gecerli dagilim uretilir", () => {
  const result = assignTeamRoles(
    team.map((row, index) =>
      index < 2 ? { ...row, forcedRole: "pos1" } : row,
    ),
  );
  assert.deepEqual(
    Object.values(result)
      .map((row) => row.role)
      .sort(),
    ["pos1", "pos2", "pos3", "pos4", "pos5"],
  );
});

test("eksik takim ve bos girdi hata vermez", () => {
  assert.deepEqual(assignTeamRoles([]), {});
  const partial = assignTeamRoles(team.slice(0, 2));
  assert.equal(Object.keys(partial).length, 2);
  assert.notEqual(partial.sven.role, partial.lina.role);
});

test("profilsiz oyuncunun tabani rankindan gelir (sabit 2500 degil)", () => {
  const match = {
    matchId: "1",
    hero: "sven",
    role: "",
    result: "win",
    durationSeconds: 2384,
    kills: 24,
    deaths: 6,
    assists: 12,
    gpm: 875,
    xpm: 900,
    heroDamage: 44438,
    towerDamage: 8000,
    lastHits: 455,
    teamKills: 60,
    teamDeaths: 32,
    obsPlaced: null,
    senPlaced: null,
    averageRankTier: 61,
  };
  const ancient = evaluateMatchPlayer({
    player: { rank: resolveRankTier(61) },
    match,
    teamRole: "pos1",
  });
  // Ancient 1 ~ 3927; mukemmel bir carry maci bunun ustunde cikmali.
  assert.ok(ancient.performanceRank > 3900, String(ancient.performanceRank));
  assert.equal(ancient.roleSource, "team");

  // Rank gizli: taban macin ortalama seviyesinden.
  const hidden = evaluateMatchPlayer({ player: null, match, teamRole: "pos1" });
  assert.ok(hidden.performanceRank > 3900, String(hidden.performanceRank));
});

test("kaybeden takimda kule vuramamak tam ceza degil", () => {
  const match = {
    matchId: "2",
    hero: "void_spirit",
    durationSeconds: 1905,
    kills: 5,
    deaths: 3,
    assists: 14,
    gpm: 452,
    xpm: 707,
    heroDamage: 19037,
    towerDamage: 0,
    lastHits: 157,
    teamKills: 31,
    teamDeaths: 56,
    obsPlaced: null,
    senPlaced: null,
    averageRankTier: 61,
  };
  const objective = (result) =>
    evaluateMatchPlayer({
      player: null,
      match: { ...match, result },
      teamRole: "pos2",
    }).breakdown.find((row) => row.key === "objectiveContribution").score;
  assert.equal(objective("win"), -1);
  assert.ok(objective("loss") > -0.5);
});

/** Ortalama seviyeli (Ancient 1) 40 dakikalik bir mac satiri. */
const statLine = (extra) => ({
  matchId: "3",
  hero: "axe",
  durationSeconds: 2400,
  kills: 8,
  deaths: 6,
  assists: 14,
  gpm: 560,
  xpm: 600,
  heroDamage: 26000,
  towerDamage: 3500,
  lastHits: 260,
  teamKills: 40,
  teamDeaths: 40,
  obsPlaced: null,
  senPlaced: null,
  averageRankTier: 61,
  result: "win",
  ...extra,
});

test("pos 3 daha cok olup daha az farm alsa da pos 1'e yakin PR alir", () => {
  const carry = evaluateMatchPlayer({
    player: null,
    match: statLine({ deaths: 5 }),
    teamRole: "pos1",
  });
  // Offlaner: iki kat olum, belirgin daha az farm ve son vurus.
  const offlane = evaluateMatchPlayer({
    player: null,
    match: statLine({ deaths: 10, gpm: 460, lastHits: 190, xpm: 550 }),
    teamRole: "pos3",
  });
  assert.ok(
    Math.abs(carry.performanceRank - offlane.performanceRank) < 250,
    carry.performanceRank + " / " + offlane.performanceRank,
  );
});

test("ayni istatistikte kazanan taraf biraz daha yuksek PR alir", () => {
  const win = evaluateMatchPlayer({
    player: null,
    match: statLine({ result: "win" }),
    teamRole: "pos3",
  });
  const loss = evaluateMatchPlayer({
    player: null,
    match: statLine({ result: "loss" }),
    teamRole: "pos3",
  });
  const gap = win.performanceRank - loss.performanceRank;
  assert.ok(gap > 50 && gap < 250, String(gap));
});

test("lane sonucu bilinmiyorsa faktor hic eklenmez (sinyali sulandirmaz)", () => {
  const evaluation = evaluateMatchPlayer({
    player: null,
    match: statLine({}),
    teamRole: "pos1",
  });
  assert.ok(!evaluation.breakdown.some((row) => row.key === "laneOutcome"));
});

test("karsi pozisyona gore geride kalan carry daha dusuk PR alir", () => {
  // Ayni sabit istatistik; tek fark karsidaki pos 1'in oyunu.
  const carry = statLine({
    result: "loss",
    gpm: 564,
    heroDamage: 18000,
    deaths: 12,
  });
  const weakOpponent = statLine({ gpm: 480, heroDamage: 15000, deaths: 12 });
  const strongOpponent = statLine({ gpm: 748, heroDamage: 29000, deaths: 6 });
  const against = (opponent) =>
    evaluateMatchPlayer({
      player: null,
      match: carry,
      teamRole: "pos1",
      lobby: { opponent },
    }).performanceRank;
  assert.ok(against(strongOpponent) < against(weakOpponent) - 100);
});

test("mac ortalamasi dusukse ayni hasar daha degerli sayilir", () => {
  const row = statLine({ heroDamage: 20000 });
  const withLobby = (heroDamagePerMinute) =>
    evaluateMatchPlayer({
      player: null,
      match: row,
      teamRole: "pos2",
      lobby: {
        averages: {
          core: {
            gpm: 520,
            xpm: 560,
            lastHitsPerMinute: 6.5,
            heroDamagePerMinute,
            deathsPerHour: 8,
          },
        },
      },
    }).performanceRank;
  assert.ok(withLobby(450) > withLobby(900));
});
