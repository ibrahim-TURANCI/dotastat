/**
 * Lobi taramasinin ISTEK BUTCESI (bkz. player-data-service getLobbyInputs).
 *
 * Korunan sozlesmeler:
 *   1. Kadrodaki oyuncu icin ag istegi atilmaz; onbellek okunur.
 *   2. Yabanci oyuncularin hepsi TEK Stratz istegiyle gelir.
 *   3. Sonuc paylasilan depoda saklanir: ikinci kurulum / yoklama istek atmaz.
 *   4. Ayni mac icin toplu istek sayisi ve sikligi sinirlidir.
 *   5. OpenDota'ya hic gidilmez; Stratz yoksa hic istek atilmaz.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  LOBBY_MAX_BATCHES,
  createPlayerDataService,
} from "../src/players/player-data-service.js";
import { listRoster } from "../src/players/roster.js";

function createMemoryStorage() {
  const rows = new Map();
  return {
    rows,
    async get(key) {
      const row = rows.get(key);
      return row && (!row.expiresAt || Date.now() <= row.expiresAt)
        ? row.value
        : null;
    },
    async set(key, value, options = {}) {
      rows.set(key, {
        value,
        expiresAt: options.ttlMs ? Date.now() + options.ttlMs : 0,
      });
    },
  };
}

/** Stratz'i taklit eder; her istegin adresini ve degiskenlerini kaydeder. */
function stubFetch(t) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body || "{}");
    calls.push({ url: String(url), variables: body.variables || {} });
    const data = {};
    for (const [name, id] of Object.entries(body.variables || {})) {
      if (!name.startsWith("p")) continue;
      data[name] = {
        steamAccount: { isAnonymous: id === 999, seasonRank: 54 },
        matches:
          id === 999
            ? []
            : [
                {
                  id: 1,
                  startDateTime: 1_760_000_000,
                  durationSeconds: 2400,
                  players: [
                    {
                      heroId: 1,
                      isVictory: true,
                      isRadiant: true,
                      position: "POSITION_1",
                    },
                  ],
                },
              ],
        heroesPerformance: [{ heroId: 1, matchCount: 80, winCount: 44 }],
      };
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

const slots = (ids) => ids.map((accountId) => ({ accountId }));

test("yabancilar tek istekte gelir, depo paylasilir", async (t) => {
  const calls = stubFetch(t);
  const storage = createMemoryStorage();
  const service = createPlayerDataService({ storage, stratzApiKey: "x" });

  const result = await service.getLobbyInputs(
    slots(["11", "12", "13", "999"]),
    {
      matchId: "m1",
    },
  );
  assert.equal(calls.length, 1);
  assert.ok(calls.every((call) => call.url.includes("stratz")));
  assert.equal(Object.keys(result).length, 4);
  assert.equal(result["11"].heroes[0].matches, 80);
  assert.equal(result["999"].isPrivate, true);

  // Ayni depoyu kullanan ikinci kurulum (baska Netlify kabi) istek atmaz;
  // gizli profil de yeniden sorulmaz.
  const other = createPlayerDataService({ storage, stratzApiKey: "x" });
  await other.getLobbyInputs(slots(["11", "12", "13", "999"]), {
    matchId: "m1",
  });
  assert.equal(calls.length, 1);
});

test("kadrodaki oyuncu icin istek atilmaz", async (t) => {
  const calls = stubFetch(t);
  const service = createPlayerDataService({
    storage: createMemoryStorage(),
    stratzApiKey: "x",
  });
  const rosterIds = listRoster().map((player) => player.player_id);
  await service.getLobbyInputs(slots(rosterIds), { matchId: "m2" });
  assert.equal(calls.length, 0);
});

test("mac basina toplu istek sikligi ve sayisi sinirli", async (t) => {
  const calls = stubFetch(t);
  const storage = createMemoryStorage();
  const service = createPlayerDataService({ storage, stratzApiKey: "x" });

  await service.getLobbyInputs(slots(["21"]), { matchId: "m3" });
  // 30 sn dolmadan yeni kimlik gorundu: beklenir.
  await service.getLobbyInputs(slots(["21", "22"]), { matchId: "m3" });
  assert.equal(calls.length, 1);

  // Bekleme dolmus gibi davran; tavana kadar izin verilir, sonra durur.
  for (let index = 0; index < LOBBY_MAX_BATCHES + 2; index += 1) {
    storage.rows.get("lobbygate:m3").value.at = 0;
    await service.getLobbyInputs(slots(["21", `3${index}`]), { matchId: "m3" });
  }
  assert.equal(calls.length, LOBBY_MAX_BATCHES);
});

test("Stratz anahtari yoksa hic istek atilmaz (OpenDota'ya dusulmez)", async (t) => {
  const calls = stubFetch(t);
  const service = createPlayerDataService({ storage: createMemoryStorage() });
  const result = await service.getLobbyInputs(slots(["41", "42"]), {
    matchId: "m4",
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(result, {});
});
