/**
 * Mac oncesi risk analizoru.
 *
 * Korunan sozlesmeler:
 *   1. Kazanma ihtimali her zaman %44 - %56 araliginda kalir.
 *   2. Gizli profil bolge rutbesini ve lobi ortalamasini alir; takimini
 *      cezalandirmaz.
 *   3. Yavas/hatali cekim digerlerini bekletmez.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePreMatchRisk,
  buildPreMatchRisk,
  comfortOf,
  loadLobbyPlayers,
  roleFitOf,
  tiltOf,
} from "../src/live/pre-match-risk.js";

const NOW = Date.parse("2026-10-18T20:00:00Z");

/** results: en yeni once "w"/"l" dizisi */
function matches(results, { hero = "axe", role = "pos3" } = {}) {
  return [...results].map((r, i) => ({
    matchId: String(i),
    startedAt: new Date(NOW - (i + 1) * 3 * 3600_000).toISOString(),
    durationSeconds: 2400,
    hero,
    role,
    result: r === "w" ? "win" : "loss",
  }));
}

const RADIANT = ["axe", "lion", "crystal_maiden", "necrolyte", "razor"];
const DIRE = ["antimage", "juggernaut", "ursa", "huskar", "viper"];

function lobby({
  radiantForm = "wwwwl",
  direForm = "wllwl",
  private: hidden = [],
} = {}) {
  return [
    ...RADIANT.map((hero, i) => ({
      slot: { accountId: `r${i}`, team: "radiant", hero, position: i + 1 },
      data: {
        matches: matches(radiantForm, { hero, role: `pos${i + 1}` }),
        rankTier: 54,
      },
      status: "ok",
    })),
    ...DIRE.map((hero, i) => ({
      slot: { accountId: `d${i}`, team: "dire", hero, position: i + 1 },
      data: {
        matches: matches(direForm, { hero: "lion", role: `pos${i + 1}` }),
        rankTier: 54,
      },
      status: "ok",
    })),
  ].map((p) =>
    hidden.includes(p.slot.accountId)
      ? { ...p, data: null, status: "private" }
      : p,
  );
}

test("tilt: seri kayip ve taze kayip yuksek tilt verir", () => {
  const recent = matches("lllll");
  recent[0].startedAt = new Date(NOW - 50 * 60_000).toISOString();
  assert.equal(tiltOf(recent, 0, NOW).level, "high");
  assert.equal(tiltOf(matches("wwlww"), 0, NOW).level, "low");
  // Esya kirma tek basina en az orta risk
  assert.equal(tiltOf(matches("wwwww"), 1, NOW).level, "medium");
});

test("konfor: spammer / ilk defa / tum zamanlar verisi yoksa nadiren", () => {
  const window = matches("w".repeat(20), { hero: "ursa" });
  assert.equal(comfortOf("ursa", window).level, "spammer");
  assert.equal(
    comfortOf("lion", window, [{ hero: "lion", matches: 0 }]).level,
    "first-time",
  );
  assert.equal(comfortOf("lion", window).level, "rare");
  assert.equal(
    comfortOf("lion", [], [{ hero: "lion", matches: 80 }]).level,
    "spammer",
  );
});

test("rol uyumu: core oyuncu pos5'te uyumsuz", () => {
  const window = matches("wwwwwww", { role: "pos1" });
  assert.equal(roleFitOf("pos1", "", window).level, "match");
  assert.equal(roleFitOf("pos2", "", window).level, "flex");
  assert.equal(roleFitOf("pos5", "", window).level, "mismatch");
  assert.equal(roleFitOf("pos5", "", []).level, "unknown");
});

test("kazanma ihtimali 44-56 araliginda ve formu iyi taraf onde", () => {
  const good = buildPreMatchRisk({
    players: lobby(),
    myTeam: "radiant",
    now: NOW,
  });
  assert.ok(good.winProbability.myTeam > 50);
  assert.equal(good.winProbability.myTeam + good.winProbability.enemyTeam, 100);

  const extreme = buildPreMatchRisk({
    players: lobby({ radiantForm: "lllll", direForm: "wwwww" }),
    myTeam: "radiant",
    now: NOW,
  });
  assert.ok(extreme.winProbability.myTeam >= 44);
  assert.ok(extreme.winProbability.myTeam < 50);
});

test("gizli profil bolge rutbesi + lobi ortalamasi alir", () => {
  const report = buildPreMatchRisk({
    players: lobby({ private: ["r0"] }),
    myTeam: "radiant",
    regionRankTier: 45,
    now: NOW,
  });
  const hidden = report.players.find((p) => p.accountId === "r0");
  assert.equal(hidden.source, "fallback");
  assert.equal(hidden.rankTier, 45);
  assert.notEqual(hidden.scores.performance, 0);
  assert.ok(report.confidence < 1);
});

test("uyarilar: tilt, erken baski ve double down", () => {
  const players = lobby();
  // Dire'nin Ursa'si spammer
  players[7].data.heroes = [{ hero: "ursa", matches: 120 }];
  const report = buildPreMatchRisk({ players, myTeam: "radiant", now: NOW });
  const types = report.alerts.map((a) => a.type);
  assert.ok(types.includes("early-pressure"), JSON.stringify(report.alerts));
  assert.match(
    report.alerts.find((a) => a.type === "early-pressure").message,
    /Ursa/,
  );

  // Takimdan biri seri kaybediyor -> tilt uyarisi, double down yok
  players[0].data.matches = matches("lllll", { hero: "axe", role: "pos1" });
  const tilted = buildPreMatchRisk({ players, myTeam: "radiant", now: NOW });
  assert.equal(tilted.alerts[0].type, "tilt");
  assert.ok(!tilted.alerts.some((a) => a.type === "double-down"));
});

test("double down: form + draft lehte ise", () => {
  const report = buildPreMatchRisk({
    players: lobby({ radiantForm: "wwwww", direForm: "llllw" }),
    myTeam: "radiant",
    now: NOW,
  });
  assert.ok(report.draft.score > 0, JSON.stringify(report.draft));
  assert.ok(
    report.alerts.some((a) => a.type === "double-down"),
    JSON.stringify(report),
  );
});

test("paralel cekim: zaman asimi ve hata digerlerini bekletmez", async () => {
  const slots = [
    { accountId: "1", team: "radiant" },
    { accountId: "2", team: "radiant" },
    { accountId: "3", team: "dire" },
    { accountId: "", team: "dire" },
  ];
  const started = Date.now();
  const loaded = await loadLobbyPlayers({
    slots,
    timeoutMs: 50,
    fetchPlayer: async (slot) => {
      if (slot.accountId === "2") return new Promise(() => {});
      if (slot.accountId === "3") throw new Error("boom");
      return { matches: matches("wl") };
    },
  });
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(
    loaded.map((p) => p.status),
    ["ok", "timeout", "failed", "private"],
  );

  const report = await analyzePreMatchRisk({
    slots,
    myTeam: "radiant",
    timeoutMs: 50,
    regionRankTier: 45,
    fetchPlayer: async () => ({ isPrivate: true }),
  });
  assert.equal(report.winProbability.myTeam, 50);
});
