/**
 * Stratz istemcisi: alan eslemesi (gercek API yanitlarindan alinmis sekiller).
 *
 *   - Parse edilmis macta ward / stack / takim kill'i / koridor sonucu dolar.
 *   - Parse edilmemis macta bu alanlar "bilinmiyor" kalir (0 degil).
 *   - Mac detayi gizli (anonim) oyuncunun hesabini ve adini gostermez.
 *   - Hero istatistigi tum zamanlar icin istenir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createStratzClient } from "../src/providers/stratz.js";

/**
 * Global fetch'i verilen GraphQL `data` ile cevaplayan sahte surum.
 * @param {Record<string, any>} data
 * @param {string[]} [queries] Gonderilen sorgular buraya yazilir
 */
function withStratz(data, queries = []) {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    queries.push(JSON.parse(String(init?.body || "{}")).query || "");
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

const PARSED = {
  id: 9042296215,
  didRadiantWin: true,
  startDateTime: 1791800000,
  durationSeconds: 3300,
  averageRank: null,
  rank: 52,
  radiantKills: [3, 4, 60],
  direKills: [10, 50, 3],
  bottomLaneOutcome: "RADIANT_VICTORY",
  midLaneOutcome: "DIRE_VICTORY",
  topLaneOutcome: "TIE",
};

const UNPARSED = {
  ...PARSED,
  id: 9040754344,
  radiantKills: [],
  direKills: [],
  bottomLaneOutcome: null,
  midLaneOutcome: null,
  topLaneOutcome: null,
};

/** 811'in gercek satirina benzer: Dire, offlane Pos 4. */
const SUPPORT_ROW = {
  heroId: 26,
  isRadiant: false,
  isVictory: false,
  kills: 6,
  deaths: 17,
  assists: 28,
  position: "POSITION_4",
  lane: "OFF_LANE",
  goldPerMinute: 280,
  experiencePerMinute: 450,
  heroDamage: 20000,
  heroHealing: 0,
  towerDamage: 100,
  numLastHits: 40,
  numDenies: 2,
  stats: {
    campStack: [0, 0, 1, 1],
    wards: [{ type: 0 }, { type: 1 }, { type: 1 }, { type: 0 }, { type: 1 }],
  },
};

test("parse edilmis mac: pozisyon, ward, stack, takim kill'i, koridor", async () => {
  const restore = withStratz({
    player: { matches: [{ ...PARSED, players: [SUPPORT_ROW] }] },
  });
  try {
    const [row] = await createStratzClient({ apiKey: "k" }).getRecentMatches(
      "244162185",
      { limit: 1 },
    );
    assert.equal(row.role, "pos4");
    assert.equal(row.obsPlaced, 2);
    assert.equal(row.senPlaced, 3);
    assert.equal(row.campsStacked, 1);
    // Dire: kendi kill'leri direKills, olumleri radiantKills.
    assert.equal(row.teamKills, 63);
    assert.equal(row.teamDeaths, 67);
    // Dire offlane = alt koridor; RADIANT_VICTORY -> kaybetti.
    assert.equal(row.laneResult, "lost");
    assert.equal(row.averageRankTier, 52);
    assert.equal(row.provider, "stratz");
  } finally {
    restore();
  }
});

test("parse edilmemis mac: ward ve takim skoru bilinmiyor", async () => {
  const restore = withStratz({
    player: {
      matches: [
        {
          ...UNPARSED,
          players: [
            {
              ...SUPPORT_ROW,
              position: null,
              lane: null,
              stats: { campStack: [], wards: [] },
            },
          ],
        },
      ],
    },
  });
  try {
    const [row] = await createStratzClient({ apiKey: "k" }).getRecentMatches(
      "1",
    );
    assert.equal(row.role, "");
    assert.equal(row.obsPlaced, null, "0 degil: bilinmiyor");
    assert.equal(row.senPlaced, null);
    assert.equal(row.campsStacked, null);
    assert.equal(row.teamKills, 0);
    assert.equal(row.laneResult, "");
  } finally {
    restore();
  }
});

test("mac detayi: gizli oyuncunun hesabi ve adi gosterilmez", async () => {
  const visible = {
    ...SUPPORT_ROW,
    steamAccountId: 244162185,
    steamAccount: { name: "811", seasonRank: 45, isAnonymous: false },
    playerSlot: 130,
    networth: 12892,
    level: 24,
    item0Id: 1,
    neutral0Id: null,
  };
  const hidden = {
    ...SUPPORT_ROW,
    isRadiant: true,
    isVictory: true,
    kills: 9,
    steamAccountId: 483343732,
    steamAccount: { name: "gizli", seasonRank: 51, isAnonymous: true },
    playerSlot: 0,
  };
  const restore = withStratz({
    match: { ...UNPARSED, players: [hidden, visible] },
  });
  try {
    const detail = await createStratzClient({ apiKey: "k" }).getMatchDetail(
      "9040754344",
    );
    assert.equal(detail.players.length, 2);
    const [anon, own] = detail.players;
    assert.equal(anon.accountId, "");
    assert.equal(anon.personaName, "");
    assert.equal(anon.rankTier, 51);
    assert.equal(own.accountId, "244162185");
    assert.equal(own.personaName, "811");
    // Parse edilmemis: skor oyuncularin kill toplamindan.
    assert.equal(detail.radiantScore, 9);
    assert.equal(detail.direScore, 6);
    assert.equal(own.teamKills, 6);
    assert.equal(own.netWorth, 12892);
  } finally {
    restore();
  }
});

test("hero istatistigi tum zamanlar icin istenir", async () => {
  const queries = [];
  const restore = withStratz(
    {
      player: {
        heroesPerformance: [{ heroId: 1, matchCount: 273, winCount: 141 }],
      },
    },
    queries,
  );
  try {
    const rows = await createStratzClient({ apiKey: "k" }).getHeroPerformance(
      "1",
    );
    assert.equal(rows[0].matches, 273);
    // request.take verilmezse Stratz yalnizca son ~25 maci sayiyor.
    assert.match(queries[0], /heroesPerformance\(request: \{ take: 100000 \}/);
  } finally {
    restore();
  }
});
