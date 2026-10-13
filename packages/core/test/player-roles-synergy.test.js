/**
 * Roller ve sinerji maclardan turer (tohum veriye bagimli degil).
 *
 *   - Roller degerlendirmelerdeki pozisyon dagilimindan, en cok oynanandan
 *     aza siralanir; %15 alti pozisyon rol sayilmaz.
 *   - Tohum rolune dusulmus degerlendirmeler ("profile") sayilmaz.
 *   - Az veride roller turetilmez (tohum korunur).
 *   - Sinerji ayni takimda oynanan maclardan olculur; az ortak macta puan yok.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { deriveRoleProfile } from "../src/players/player-style.js";
import { buildPlayerSynergy } from "../src/players/player-synergy.js";
import { buildPlayerEvaluation } from "../src/players/evaluation.js";

/** @param {Array<[string, number]>} spec rol -> mac sayisi */
function evaluationsOf(spec, source = "provider") {
  let id = 0;
  return spec.flatMap(([role, count]) =>
    Array.from({ length: count }, () => ({
      matchId: String(++id),
      role,
      roleSource: source,
    })),
  );
}

test("roller pozisyon dagilimina gore siralanir", () => {
  const profile = deriveRoleProfile(
    evaluationsOf([
      ["pos2", 5],
      ["pos3", 7],
      ["pos4", 3],
      ["pos1", 1],
    ]),
  );
  assert.equal(profile.primaryRole, "pos3");
  assert.deepEqual(profile.secondaryRoles, ["pos2", "pos4"]);
  assert.equal(profile.sample, 16);
  assert.equal(profile.roleShares[0].share, 0.44);
});

test("tohum rolune dusen degerlendirmeler sayilmaz, az veride null", () => {
  assert.equal(
    deriveRoleProfile(evaluationsOf([["pos1", 9]], "profile")),
    null,
  );
  assert.equal(deriveRoleProfile(evaluationsOf([["pos1", 4]])), null);
});

test("degerlendirme paketi rolleri maclardan yazar", () => {
  const matches = Array.from({ length: 8 }, (_, index) => ({
    matchId: String(index + 1),
    hero: "axe",
    role: index < 6 ? "pos3" : "pos4",
    provider: "stratz",
    result: "win",
    durationSeconds: 2400,
    kills: 5,
    deaths: 5,
    assists: 10,
    teamKills: 30,
    gpm: 450,
    xpm: 550,
    lastHits: 150,
    heroDamage: 20000,
    startedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
  }));
  const { player } = buildPlayerEvaluation({
    player: {
      id: "x",
      name: "X",
      player_id: "1",
      dotaProfile: { primaryRole: "pos1", secondaryRoles: [] },
    },
    matches,
  });
  assert.equal(player.dotaProfile.primaryRole, "pos3");
  assert.deepEqual(player.dotaProfile.secondaryRoles, ["pos4"]);
  assert.equal(player.dotaProfile.roleSource, "matches");
});

test("sinerji ayni takimdaki maclardan olculur", () => {
  const matches = [];
  const evaluations = [];
  const squads = {};
  for (let index = 1; index <= 8; index += 1) {
    const matchId = String(index);
    const together = index <= 4;
    const win = together ? index !== 4 : index === 5;
    matches.push({ matchId, hero: "axe", result: win ? "win" : "loss" });
    evaluations.push({
      matchId,
      role: "pos3",
      roleSource: "provider",
      performanceRank: together ? 3200 : 2800,
    });
    squads[matchId] = {
      members: [
        { id: "me", self: true, team: "ally" },
        ...(together
          ? [
              {
                id: "ali",
                name: "Ali",
                team: "ally",
                role: "pos1",
                hero: "juggernaut",
              },
            ]
          : []),
        { id: "veli", name: "Veli", team: "enemy" },
      ],
    };
  }
  const synergy = buildPlayerSynergy({ matches, evaluations, squads });
  assert.equal(synergy.known, 8);
  assert.equal(synergy.partners.length, 1, "rakipteki uye sinerjiye girmez");
  const [ali] = synergy.partners;
  assert.equal(ali.matches, 4);
  assert.equal(ali.wins, 3);
  assert.equal(ali.rankDelta, 400);
  assert.ok(ali.score > 60);
  assert.ok(ali.strengths.length >= 2);
  assert.equal(ali.rolePairs[0].selfKey, "pos3");
  assert.equal(ali.rolePairs[0].partnerKey, "pos1");
});

test("az ortak macta puan ve yorum yok", () => {
  const synergy = buildPlayerSynergy({
    matches: [{ matchId: "1", result: "win" }],
    squads: {
      1: { members: [{ id: "ali", name: "Ali", team: "ally" }] },
    },
  });
  assert.equal(synergy.partners[0].score, null);
  assert.deepEqual(synergy.partners[0].strengths, []);
});

test("istatistikten tahmin edilen rol dagilima katilmaz", () => {
  // Cikarim core oynanan her maci pos1 sayar; pozisyonu bilinmeyen 20 mac
  // rolu pos1 yapmamali.
  const evaluations = [
    ...evaluationsOf([["pos1", 20]], "inferred"),
    ...evaluationsOf([["pos3", 6]], "provider"),
  ];
  const profile = deriveRoleProfile(evaluations);
  assert.equal(profile.primaryRole, "pos3");
  assert.equal(profile.sample, 6);
});
