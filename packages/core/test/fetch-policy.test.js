/**
 * Ag istegi politikasi ve eksik veri davranisi testleri.
 *
 * Iki sozlesme korunuyor:
 *   1. Dis kaynaga YALNIZCA elde hic veri yokken ya da kullanici acikca
 *      tazeleme istediginde gidilir. Eskimislik tek basina sebep degildir.
 *   2. Saglayicinin vermedigi olcut (ward sayilari) 0 sayilmaz; ilgili faktor
 *      degerlendirmeden tamamen cikarilir.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createPlayerDataService } from "../src/players/player-data-service.js";
import { evaluateMatchPlayer } from "../src/players/performance-evaluation-engine.js";

/** Bellekte calisan, TTL'i gercekten uygulayan sahte depolama. */
function createMemoryStorage(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    async get(key) {
      const row = rows.get(key);
      if (!row) {
        return null;
      }
      if (row.expiresAt && Date.now() > row.expiresAt) {
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
 * @param {string} matchId
 * @returns {import("../src/players/player-types.js").PlayerMatch}
 */
const sampleMatch = (matchId) => ({
  matchId,
  playerId: "1",
  startedAt: new Date().toISOString(),
  durationSeconds: 2400,
  hero: "crystal_maiden",
  role: "pos5",
  result: "win",
  kills: 3,
  deaths: 5,
  assists: 18,
  gpm: 300,
  xpm: 400,
  heroDamage: 12000,
  heroHealing: 2000,
  towerDamage: 100,
  lastHits: 40,
  denies: 2,
  obsPlaced: null,
  senPlaced: null,
  campsStacked: null,
  teamKills: 30,
  teamDeaths: 20,
  laneResult: "",
  provider: "opendota",
});

const player = {
  id: "test",
  name: "Test",
  player_id: "1",
  dotaProfile: {
    primaryRole: "pos5",
    secondaryRoles: [],
    signatureHeroes: [],
    preferredHeroes: [],
    weakHeroes: [],
    experimentalHeroes: [],
  },
  performanceProfile: {},
};

test("eskimis veri varken kendiliginden ag istegi atilmaz", async () => {
  let fetchCount = 0;
  const storage = createMemoryStorage({
    // TTL'i dolmus taze kopya yok; yalnizca suresiz "stale" kopya var.
    "matches:1:stale": {
      value: { matches: [sampleMatch("100")], fetchedAt: "2020-01-01T00:00:00Z" },
      expiresAt: 0,
    },
  });

  const service = createPlayerDataService({ storage });
  service.client.getRecentMatches = async () => {
    fetchCount += 1;
    return [sampleMatch("200")];
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  const bundle = await service.getPlayerBundle(player);

  assert.equal(fetchCount, 0, "eskimis veri icin ag istegi atilmamali");
  assert.equal(bundle.matches[0].matchId, "100", "eski veri gosterilmeli");
});

test("elde hic veri yoksa ilk acilista cekilir", async () => {
  let fetchCount = 0;
  const storage = createMemoryStorage();

  const service = createPlayerDataService({ storage });
  service.client.getRecentMatches = async () => {
    fetchCount += 1;
    return [sampleMatch("200")];
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  const bundle = await service.getPlayerBundle(player);

  assert.equal(fetchCount, 1);
  assert.equal(bundle.matches[0].matchId, "200");
});

test("acik tazeleme istegi eskimis veriyi yeniler", async () => {
  let fetchCount = 0;
  const storage = createMemoryStorage({
    "matches:1:stale": {
      value: { matches: [sampleMatch("100")], fetchedAt: "2020-01-01T00:00:00Z" },
      expiresAt: 0,
    },
  });

  const service = createPlayerDataService({ storage });
  service.client.getRecentMatches = async () => {
    fetchCount += 1;
    return [sampleMatch("200")];
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.equal(fetchCount, 1);
  assert.equal(bundle.matches[0].matchId, "200");
});

test("panel tazeleme olmadan yalnizca verisi olmayanlari ceker", async () => {
  const storage = createMemoryStorage();
  const service = createPlayerDataService({ storage });

  let fetchCount = 0;
  service.client.getRecentMatches = async () => {
    fetchCount += 1;
    return [sampleMatch("300")];
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  // Ilk cagri: kimsenin verisi yok, istek basina en fazla `maxRefresh` kadari
  // cekilir; kadro daha kalabalik oldugu icin doldurma birkac ziyarete yayilir.
  await service.getRosterDashboard();
  assert.ok(fetchCount > 0, "ilk acilista veri cekilmeli");

  // Herkesin verisi dolana kadar tekrarla (kademeli doldurma).
  for (let round = 0; round < 10 && fetchCount > 0; round += 1) {
    fetchCount = 0;
    await service.getRosterDashboard();
  }

  // Artik herkesin verisi var: bundan sonraki ziyaretler ag istegi atmamali,
  // TTL dolsa bile. Asil korunan sozlesme budur.
  fetchCount = 0;
  await service.getRosterDashboard();
  await service.getRosterDashboard();
  assert.equal(fetchCount, 0, "veri tamamlandiktan sonra istek atilmamali");

  // Veri AZ ONCE cekildigi icin acik tazeleme de atlanir: onbellek tum
  // ziyaretciler arasinda paylasildigindan ayni veriyi tekrar cekmek
  // kimseye bir sey kazandirmaz, yalnizca gunluk kotayi harcar.
  fetchCount = 0;
  const blocked = await service.getRosterDashboard({ refresh: true });
  assert.equal(fetchCount, 0, "cok taze veride tazeleme atlanmali");
  assert.equal(blocked.refreshSkipped, true);
  assert.ok(blocked.refreshAvailableInMs > 0, "kalan sure bildirilmeli");
});

test("veri eskidiginde acik tazeleme yeniden calisir", async () => {
  // Bekleme suresinden daha eski bir kayit: tazeleme serbest olmali.
  const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const storage = createMemoryStorage({
    "matches:1:stale": {
      value: { matches: [sampleMatch("900")], fetchedAt: old },
      expiresAt: 0,
    },
  });

  const service = createPlayerDataService({ storage });
  let fetchCount = 0;
  service.client.getRecentMatches = async () => {
    fetchCount += 1;
    return [sampleMatch("901")];
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.equal(fetchCount, 1, "eski veride tazeleme calismali");
  assert.equal(bundle.refreshSkipped, false);
  assert.equal(bundle.matches[0].matchId, "901");
});

test("cok yeni veride tazeleme atlanir ama veri yine doner", async () => {
  const fresh = new Date(Date.now() - 60 * 1000).toISOString(); // 1 dakika
  const storage = createMemoryStorage({
    "matches:1:stale": {
      value: { matches: [sampleMatch("910")], fetchedAt: fresh },
      expiresAt: 0,
    },
  });

  const service = createPlayerDataService({ storage });
  let fetchCount = 0;
  service.client.getRecentMatches = async () => {
    fetchCount += 1;
    return [sampleMatch("911")];
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  const bundle = await service.getPlayerBundle(player, { refresh: true });

  assert.equal(fetchCount, 0, "1 dakikalik veri icin istek atilmamali");
  assert.equal(bundle.refreshSkipped, true);
  // Ekran bos kalmaz: mevcut veri yine gosterilir.
  assert.equal(bundle.matches[0].matchId, "910");
  // Kalan sure yaklasik 4 dakika olmali (5 dk pencere - 1 dk yas).
  const minutes = bundle.refreshAvailableInMs / 60000;
  assert.ok(minutes > 3.5 && minutes < 4.5, `beklenmeyen sure: ${minutes}`);
});

test("veri donmeyen oyuncu her acilista yeniden denenmez", async () => {
  const storage = createMemoryStorage();
  const service = createPlayerDataService({ storage });

  let fetchCount = 0;
  // Profili gizli oyuncu: uc bos liste doner.
  service.client.getRecentMatches = async () => {
    fetchCount += 1;
    return [];
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  await service.getPlayerBundle(player);
  assert.equal(fetchCount, 1, "ilk denemede cekilmeli");

  await service.getPlayerBundle(player);
  await service.getPlayerBundle(player);
  assert.equal(fetchCount, 1, "sonraki acilislarda tekrar denenmemeli");

  // Kullanici acikca isterse yine denenir.
  await service.getPlayerBundle(player, { refresh: true });
  assert.equal(fetchCount, 2, "acik tazelemede yeniden denenmeli");
});

test("mac verisi gizli oyuncuda mac/hero uclarina hic gidilmez", async () => {
  const storage = createMemoryStorage();
  const service = createPlayerDataService({ storage });

  let matchCalls = 0;
  let heroCalls = 0;
  service.client.getPlayerProfile = async () => ({
    playerId: "1",
    name: "811",
    avatar: "",
    steamId: "",
    // OpenDota'da fh_unavailable, Stratz'ta isAnonymous karsiligi.
    historyUnavailable: true,
    rankTier: 44,
    leaderboardRank: null,
    provider: "opendota",
    fetchedAt: new Date().toISOString(),
  });
  service.client.getRecentMatches = async () => {
    matchCalls += 1;
    return [];
  };
  service.client.getHeroPerformance = async () => {
    heroCalls += 1;
    return [];
  };

  const bundle = await service.getPlayerBundle(player);

  assert.equal(bundle.historyUnavailable, true);
  assert.equal(matchCalls, 0, "mac ucuna gidilmemeli");
  assert.equal(heroCalls, 0, "hero ucuna gidilmemeli");
  // Rank yine de profilden gelir.
  assert.ok(bundle.player.rank, "rank madalyasi gosterilebilmeli");
});

test("gizli gecmisli oyuncu 'bekleyen' listesine girmez", async () => {
  const storage = createMemoryStorage();
  const service = createPlayerDataService({ storage });

  service.client.getPlayerProfile = async () => ({
    playerId: "x",
    name: "",
    avatar: "",
    steamId: "",
    historyUnavailable: true,
    rankTier: 44,
    leaderboardRank: null,
    provider: "opendota",
    fetchedAt: new Date().toISOString(),
  });
  service.client.getRecentMatches = async () => [];
  service.client.getHeroPerformance = async () => [];

  // Panel istek basina en fazla `maxRefresh` oyuncuya bakar; kadro daha
  // kalabalik oldugu icin durum birkac ziyarete yayilir.
  let dashboard = await service.getRosterDashboard();
  for (let round = 0; round < 10 && dashboard.pendingPlayers.length; round++) {
    dashboard = await service.getRosterDashboard();
  }

  assert.equal(
    dashboard.pendingPlayers.length,
    0,
    "beklemekle gelmeyecek veri 'bekleniyor' diye gosterilmemeli",
  );
  assert.ok(dashboard.hiddenPlayers.length > 0, "ayri listede raporlanmali");
});

test("eski semayla yazilmis onbellekte ward sifirlari null'a cevrilir", async () => {
  // Surum 1 kaydi: ward alanlari 0 yaziyor ("veri yok" anlaminda).
  const legacyMatch = { ...sampleMatch("700"), obsPlaced: 0, senPlaced: 0 };
  const storage = createMemoryStorage({
    "matches:1:stale": {
      value: { matches: [legacyMatch], fetchedAt: "2020-01-01T00:00:00Z" },
      expiresAt: 0,
    },
  });

  const service = createPlayerDataService({ storage });
  service.client.getRecentMatches = async () => {
    throw new Error("ag istegi atilmamaliydi");
  };
  service.client.getPlayerProfile = async () => null;
  service.client.getHeroPerformance = async () => [];

  const bundle = await service.getPlayerBundle(player);

  assert.equal(bundle.matches[0].obsPlaced, null);
  assert.equal(bundle.matches[0].senPlaced, null);

  // Otomatik tazeleme kaldirildigi icin eski kayitlar kendiliginden
  // duzelmezdi; bu goc olmadan support puanlari yanlis kalirdi.
  const evaluation = bundle.evaluations[0];
  assert.ok(
    !evaluation.breakdown.some((row) => row.key === "visionContribution"),
    "eski kayitta da vision faktoru cikarilmali",
  );
});

test("ward verisi yoksa vision faktoru degerlendirmeden cikar", () => {
  const match = sampleMatch("400");

  const unknown = evaluateMatchPlayer({ player: null, match });
  const known = evaluateMatchPlayer({
    player: null,
    match: { ...match, obsPlaced: 0, senPlaced: 0 },
  });

  const unknownVision = unknown.breakdown.find(
    (row) => row.key === "visionContribution",
  );
  const knownVision = known.breakdown.find(
    (row) => row.key === "visionContribution",
  );

  assert.equal(unknownVision, undefined, "bilinmiyorsa faktor eklenmemeli");
  assert.ok(knownVision, "gercekten 0 ise faktor kalmali");
  assert.equal(knownVision.score, -1);

  // Eksik veri, kotu performans sayilmamali.
  assert.ok(
    unknown.performanceRank > known.performanceRank,
    "bilinmeyen ward, sifir warddan daha iyi puanlanmali",
  );
});

test("faktor dustugunde kalan agirliklarin toplami 1 kalir", () => {
  const evaluation = evaluateMatchPlayer({
    player: null,
    match: sampleMatch("500"),
  });
  const total = evaluation.breakdown.reduce((sum, row) => sum + row.weight, 0);
  assert.ok(
    Math.abs(total - 1) < 0.001,
    `agirlik toplami 1 olmali, ${total} bulundu`,
  );
});

test("ward verisi yoksa rol cikarimi support'u core sanmaz", () => {
  // Dusuk last hit + dusuk GPM: ward sinyali olmadan da support cikmali.
  const evaluation = evaluateMatchPlayer({
    player: null,
    match: { ...sampleMatch("600"), role: "", lastHits: 25, gpm: 250 },
  });
  assert.equal(evaluation.roleGroup, "support");
});
