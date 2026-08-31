/**
 * "Tazelenemedi" ile "veri yok" ayrimi.
 *
 * KORUNAN SOZLESME: basarisiz ya da bos donen bir tazeleme, EKRANDAKI VERIYI
 * SILMEZ. Kaynak gunluk limite takildiginda veya bos liste dondurdugunde
 * kullanici "Yenile"ye bastigi icin cezalandirilmamali.
 *
 * Bu davranis bir kez kaybedildi: elle yenileme dolu bir paneli "9 oyuncu
 * verisi bekleniyor"a dusuruyordu, cunku bayat kopya yalnizca tazeleme
 * ISTENMEDIGINDE okunuyordu.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createPlayerDataService } from "../src/players/player-data-service.js";
import { listRoster } from "../src/players/roster.js";

/** Bellek ici depo (Netlify Blobs / disk yerine). */
function memoryStorage() {
  const map = new Map();
  return {
    map,
    async get(key) {
      const row = map.get(key);
      if (!row) {
        return null;
      }
      if (row.expiresAt && Date.now() > row.expiresAt) {
        return null;
      }
      return row.value;
    },
    async set(key, value, options = {}) {
      map.set(key, {
        value,
        expiresAt: options.ttlMs ? Date.now() + Number(options.ttlMs) : 0,
      });
    },
  };
}

/**
 * @param {string} matchId
 * @param {number} minutesAgo
 */
function match(matchId, minutesAgo) {
  return {
    matchId,
    hero: "juggernaut",
    result: "win",
    startedAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    durationSeconds: 2000,
    kills: 9,
    deaths: 3,
    assists: 12,
    gpm: 520,
    xpm: 610,
    lastHits: 210,
    heroDamage: 22000,
    towerDamage: 4000,
    heroHealing: 0,
    obsPlaced: null,
    senPlaced: null,
    campsStacked: null,
    lane: 1,
    laneRole: 1,
    isRadiant: true,
    provider: "test",
  };
}

const RANK = {
  tier: 54,
  medal: 5,
  stars: 4,
  label: "Legend 4",
  leaderboardRank: null,
  provider: "test",
  fetchedAt: "2026-08-20T10:00:00.000Z",
};

/**
 * Elde DURAN veri: bayat kopya + profil. TTL'li taze kayit bilerek yazilmaz,
 * boylece "tazeleme sirasinda ne oluyor" yolu sinanir.
 *
 * @param {ReturnType<typeof memoryStorage>} storage
 * @param {string} playerId
 */
async function seedExistingData(storage, playerId) {
  const row = {
    matches: [match("111", 200), match("112", 900)],
    fetchedAt: "2026-08-30T09:00:00.000Z",
    schema: 2,
  };
  await storage.set("matches:" + playerId + ":stale", row);
  await storage.set("profile:" + playerId + ":stale", {
    name: "Test",
    avatar: "https://example.invalid/a.jpg",
    steamId: "",
    rank: RANK,
    historyUnavailable: false,
    fetchedAt: "2026-08-30T09:00:00.000Z",
  });
  await storage.set("heroes:" + playerId + ":stale", {
    heroes: [{ hero: "juggernaut", matches: 40, wins: 24, winRate: 0.6 }],
    fetchedAt: "2026-08-30T09:00:00.000Z",
  });
}

/**
 * Her seye BOS cevap veren kaynak (limit dolmus gibi: hata degil, veri yok).
 */
function emptyProvider() {
  return {
    async getRecentMatches() {
      return [];
    },
    async getRecentMatchesFreshest() {
      return [];
    },
    async getPlayerProfile() {
      return null;
    },
    async getHeroPerformance() {
      return [];
    },
    async requestRefresh() {},
  };
}

/** Her seye HATA veren kaynak (ag koptu / 429). */
function failingProvider() {
  const boom = async () => {
    throw new Error("rate-limit");
  };
  return {
    getRecentMatches: boom,
    getRecentMatchesFreshest: boom,
    getPlayerProfile: boom,
    getHeroPerformance: boom,
    async requestRefresh() {},
  };
}

/**
 * Servisi verilen sahte kaynakla kurar.
 *
 * `createPlayerDataService` zinciri kendi kuruyor; testte disaridan kaynak
 * gecirmek icin donen nesnenin `client`indeki METOTLAR degistirilir.
 * (`lastUsedProvider` gibi alanlar salt okunur getter'dir, onlara dokunulmaz.)
 *
 * @param {ReturnType<typeof memoryStorage>} storage
 * @param {Record<string, Function>} provider
 */
function serviceWith(storage, provider) {
  const service = createPlayerDataService({ storage });
  for (const [name, fn] of Object.entries(provider)) {
    service.client[name] = fn;
  }
  return service;
}

const player = listRoster()[0];

test("bos donen tazeleme, duran maclari silmez", async () => {
  const storage = memoryStorage();
  await seedExistingData(storage, player.player_id);

  const service = serviceWith(storage, emptyProvider());
  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.equal(bundle.matches.length, 2, "eski maclar ekranda kalmali");
  assert.equal(bundle.stale, true, "veri bayat olarak isaretlenmeli");
  assert.equal(
    bundle.fetchedAt,
    "2026-08-30T09:00:00.000Z",
    "bayat kopyanin yasi korunmali; bos sonuc 'az once guncellendi' yazmamali",
  );
});

test("hata veren tazeleme, duran maclari silmez", async () => {
  const storage = memoryStorage();
  await seedExistingData(storage, player.player_id);

  const service = serviceWith(storage, failingProvider());
  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.equal(bundle.matches.length, 2);
  assert.equal(bundle.stale, true);
  assert.ok(bundle.providerError, "hata arayuze bildirilmeli");
});

test("bos donen tazeleme, madalyayi (ve yaklasik MMR'i) silmez", async () => {
  const storage = memoryStorage();
  await seedExistingData(storage, player.player_id);

  const service = serviceWith(storage, emptyProvider());
  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.deepEqual(
    bundle.player.rank,
    RANK,
    "madalya korunmali — kaybolursa yaklasik MMR de kaybolur",
  );
});

test("hata veren tazeleme, madalyayi silmez", async () => {
  const storage = memoryStorage();
  await seedExistingData(storage, player.player_id);

  const service = serviceWith(storage, failingProvider());
  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.deepEqual(bundle.player.rank, RANK);
});

test("bos donen tazeleme, hero istatistigini silmez", async () => {
  const storage = memoryStorage();
  await seedExistingData(storage, player.player_id);

  const service = serviceWith(storage, emptyProvider());
  const heroes = await service.getHeroPerformance(player, { refresh: true });

  assert.equal(heroes.heroes.length, 1, "kariyer hero listesi korunmali");
});

test("hic verisi olmayan oyuncu yine de bos doner", async () => {
  // Bayat kopya YOKSA uydurulacak bir sey yok; "veri bekleniyor" dogru cevap.
  const storage = memoryStorage();
  const service = serviceWith(storage, emptyProvider());
  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.equal(bundle.matches.length, 0);
  assert.equal(bundle.stale, false);
});

test("panel, bayat veriyi 'bekleyen' saymaz", async () => {
  const storage = memoryStorage();
  for (const row of listRoster()) {
    await seedExistingData(storage, row.player_id);
  }

  const service = serviceWith(storage, emptyProvider());
  const dashboard = await service.getRosterDashboard({ refresh: true });

  assert.deepEqual(
    dashboard.pendingPlayers,
    [],
    "verisi duran oyuncu 'veri bekleniyor' listesine girmemeli",
  );
  assert.ok(
    dashboard.cards.every((row) => row.hasData),
    "tum kartlarda veri kalmali",
  );
});

/**
 * "Mac gecmisi gizli" isareti KALICI DEGILDIR.
 *
 * Oyuncu Dota'dan "Maç Verilerini Herkese Açık Yap"i actiginda site bunu
 * ogrenebilmeli. Onceden ogrenemiyordu: gizli isaretli oyuncu hem otomatik
 * doldurma kuyrugundan hem elle tazelemeden eleniyordu, kart sonsuza kadar
 * "gizli" kaliyordu.
 */

/** Once gizli, sonra acilmis bir profil dondurur. */
function reopenedProvider(matches) {
  return {
    async getPlayerProfile(playerId) {
      return {
        playerId: String(playerId),
        name: "Test",
        avatar: "",
        steamId: "",
        // Oyuncu ayari ACTI: artik gizli degil.
        historyUnavailable: false,
        rankTier: 54,
        leaderboardRank: null,
        provider: "test",
        fetchedAt: new Date().toISOString(),
      };
    },
    async getRecentMatches() {
      return matches;
    },
    async getRecentMatchesFreshest() {
      return matches;
    },
    async getHeroPerformance() {
      return [];
    },
    async requestRefresh() {},
  };
}

/**
 * @param {ReturnType<typeof memoryStorage>} storage
 * @param {string} playerId
 * @param {string} profileFetchedAt
 */
async function seedHiddenProfile(storage, playerId, profileFetchedAt) {
  const row = {
    name: "Test",
    avatar: "",
    steamId: "",
    rank: RANK,
    historyUnavailable: true,
    fetchedAt: profileFetchedAt,
  };
  await storage.set("profile:" + playerId + ":stale", row);
}

test("gizli isaretli oyuncu elle tazelemede yeniden sorulur", async () => {
  const storage = memoryStorage();
  const target = listRoster()[0];
  // Profil bir gun once "gizli" olarak kaydedilmis.
  await seedHiddenProfile(
    storage,
    target.player_id,
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );

  const service = serviceWith(
    storage,
    reopenedProvider([match("500", 60), match("501", 300)]),
  );
  const dashboard = await service.getRosterDashboard({ refresh: true });
  const card = dashboard.cards.find((row) => row.id === target.id);

  assert.equal(card.historyUnavailable, false, "isaret guncellenmeli");
  assert.equal(card.hasData, true, "maclar gelmeli");
});

test("gizli isaret az once sorulduysa tekrar sorulmaz", async () => {
  const storage = memoryStorage();
  const target = listRoster()[0];
  // Profil AZ ONCE sorulmus: 30 dakikalik kisit devrede.
  await seedHiddenProfile(storage, target.player_id, new Date().toISOString());

  const service = serviceWith(storage, reopenedProvider([match("500", 60)]));
  const dashboard = await service.getRosterDashboard({ refresh: true });
  const card = dashboard.cards.find((row) => row.id === target.id);

  assert.equal(
    card.historyUnavailable,
    true,
    "arka arkaya tiklamak kota harcamamali",
  );
});
