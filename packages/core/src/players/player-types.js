/**
 * Oyuncu değerlendirme sistemi tip sözleşmeleri.
 *
 * Proje saf CommonJS JavaScript olduğu için TypeScript interface yerine
 * JSDoc typedef kullanılır. Sözleşme aynı, ekstra build adımı gerekmez.
 *
 * ÖNEMLİ: performanceProfile ve performanceRank değerleri GERÇEK MMR DEĞİLDİR.
 * Bunlar "hangi seviyede oynuyor" tahminidir (Performance Rank).
 */

/** @typedef {"pos1"|"pos2"|"pos3"|"pos4"|"pos5"} RoleKey */
/** @typedef {"excellent"|"good"|"neutral"|"poor"} FitLevel */
/** @typedef {"ahead"|"even"|"behind"} GameState */
/** @typedef {"won"|"draw"|"lost"} LaneResult */
/** @typedef {"win"|"loss"} MatchResult */

/**
 * @typedef {Object} PerformanceRange
 * @property {number} min
 * @property {number} max
 */

/**
 * @typedef {Object} PerformanceProfile
 * @property {PerformanceRange} strongHeroPerformance  En iyi herolarında verebildiği seviye
 * @property {PerformanceRange} gameKnowledgeLevel     Teorik oyun bilgisi seviyesi
 * @property {PerformanceRange} averageHeroPerformance Ortalama hero seviyesi
 * @property {PerformanceRange} weakHeroPerformance    Zayıf herolardaki seviyesi
 * @property {PerformanceRange} unplayableHeroCount    Hiç oynayamadığı tahmini hero sayısı
 * @property {number} actualRank                       Gerçek rank tahmini (MMR iddiası değil)
 */

/**
 * @typedef {Object} DotaProfile
 * @property {RoleKey|""} primaryRole
 * @property {RoleKey[]} secondaryRoles
 * @property {string[]} signatureHeroes   TUM oyunlarda cok oynanan + kazanilan
 * @property {string[]} preferredHeroes   SON maclarda sik alinan
 * @property {string[]} weakHeroes        Yeterince oynanip kazanilamayan
 * @property {string[]} [recommendedHeroes] Tarzina uyan, az/hic oynanmis
 * @property {string[]} experimentalHeroes `recommendedHeroes` ile ayni; eski ad
 */

/**
 * Bir kahramanin TUM zamanlar performansi (saglayicidan).
 * @typedef {Object} HeroPerformanceRow
 * @property {string} hero
 * @property {number} matches
 * @property {number} wins
 * @property {number} winRate
 * @property {number} [avgKda]
 * @property {string} [provider]
 */

/**
 * @typedef {Object} PlayerCharacter
 * @property {string} generalPlaystyle
 * @property {string[]} strengths
 * @property {string[]} weaknesses
 * @property {string[]} developmentAreas
 * @property {string} laneBehavior
 * @property {string} teamfightBehavior
 * @property {string} mapTempoVisionBehavior
 * @property {string} bestTeamUsage
 * @property {string[]} synergyNotes
 * @property {string} funnyAdvice
 */

/**
 * @typedef {Object} Player
 * @property {string} id            Dahili slug (ör. "janissary")
 * @property {string} name
 * @property {string} player_id     Dota account id (32-bit). Provider anahtarı.
 * @property {string} avatar
 * @property {boolean} active
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {DotaProfile} dotaProfile
 * @property {PlayerCharacter} character
 * @property {PerformanceProfile} performanceProfile
 * @property {PlayerRank|null} rank Gercek Dota rank madalyasi (provider'dan)
 * @property {string} rankFetchedAt
 * @property {string} source        "seed" | "manual" | provider adı
 */

/**
 * @typedef {Object} PlayerMatch
 * @property {string} matchId
 * @property {string} playerId
 * @property {string} startedAt     ISO tarih
 * @property {number} durationSeconds
 * @property {string} hero          normalize hero key (ör. "dark_seer")
 * @property {RoleKey|""} role
 * @property {MatchResult} result
 * @property {number} kills
 * @property {number} deaths
 * @property {number} assists
 * @property {number} gpm
 * @property {number} xpm
 * @property {number} heroDamage
 * @property {number} heroHealing
 * @property {number} towerDamage
 * @property {number} lastHits
 * @property {number} denies
 * @property {number|null} obsPlaced   null = saglayici vermedi (0 ile ayni degil)
 * @property {number|null} senPlaced   null = saglayici vermedi (0 ile ayni degil)
 * @property {number} campsStacked
 * @property {number} teamKills
 * @property {number} teamDeaths
 * @property {LaneResult|""} laneResult
 * @property {number|null} [averageRankTier] Maçın ortalama rank kademesi
 *   (ör. 54 = Legend 4). null = sağlayıcı vermedi.
 * @property {string} provider      Veriyi üreten provider adı
 */

/**
 * @typedef {Object} PlayerStats
 * @property {string} playerId
 * @property {number} matches
 * @property {number} wins
 * @property {number} winRate
 * @property {Record<string, { matches: number, wins: number, winRate: number }>} roles
 * @property {Array<{ hero: string, matches: number, wins: number, winRate: number, avgKda: number }>} heroes
 * @property {string} provider
 * @property {string} fetchedAt
 */

/**
 * @typedef {Object} PlayerProfileSnapshot
 * @property {string} playerId
 * @property {string} name
 * @property {string} avatar
 * @property {number|null} rankTier  Iki haneli Dota rank kodu (54 = Legend 4)
 * @property {number|null} [leaderboardRank]
 * @property {string} provider
 * @property {string} fetchedAt
 */

/**
 * Rank madalyasi gosterimi icin cozulmus rank bilgisi.
 * @typedef {Object} PlayerRank
 * @property {number} tier          Ham rank_tier (ornek 54)
 * @property {number} medal         1-8 (Herald..Immortal)
 * @property {number} stars         0-5
 * @property {string} label         "Legend 4"
 * @property {number|null} leaderboardRank
 * @property {string} provider
 * @property {string} fetchedAt
 */

/**
 * @typedef {Object} EvaluationContext
 * @property {boolean} teamWon
 * @property {GameState} [gameState]
 * @property {LaneResult} [laneResult]
 */

/**
 * @typedef {Object} PerformanceEvaluation
 * @property {string} playerId
 * @property {string} matchId
 * @property {number} performanceRank
 * @property {RoleKey} role                Degerlendirmede kullanilan rol
 * @property {"core"|"support"} roleGroup  Hangi olcut setiyle bakildi
 * @property {"manual"|"provider"|"inferred"|"profile"} roleSource
 * @property {number} [confidence]
 * @property {string} summary
 * @property {string[]} strengths
 * @property {string[]} mistakes
 * @property {FitLevel} [heroFit]
 * @property {FitLevel} [roleFit]
 * @property {EvaluationContext} context
 * @property {number} [rawPerformanceRank] Maç ortalamasına çekilmeden önceki tahmin
 * @property {number} [matchAverageRank]   Maçın ortalama seviyesi (0 = bilinmiyor)
 * @property {"match"|"player"|""} [matchAverageRankSource] Ortalamanın kaynağı
 * @property {string} createdAt
 * @property {Array<{ key: string, label: string, score: number, weight: number, note: string }>} [breakdown]
 */

/**
 * @typedef {Object} PlayerSynergy
 * @property {string} id
 * @property {string} playerId1
 * @property {string} playerId2
 * @property {number} [synergyScore] 0-100
 * @property {string} description
 * @property {string[]} strengths
 * @property {string[]} risks
 */

/**
 * Provider sözleşmesi. Bkz. src/services/providers/base-provider.js
 *
 * @typedef {Object} PlayerDataProvider
 * @property {string} name
 * @property {boolean} isConfigured
 * @property {(playerId: string) => Promise<PlayerProfileSnapshot|null>} getPlayerProfile
 * @property {(playerId: string, options?: { limit?: number }) => Promise<PlayerMatch[]>} getRecentMatches
 * @property {(playerId: string, options?: { limit?: number }) => Promise<PlayerStats|null>} getPlayerStats
 */

/** @type {RoleKey[]} */
const ROLE_KEYS = ["pos1", "pos2", "pos3", "pos4", "pos5"];

/** @type {Record<RoleKey, string>} */
const ROLE_LABELS = {
  pos1: "Pos 1 / Safelane Carry",
  pos2: "Pos 2 / Mid",
  pos3: "Pos 3 / Offlane",
  pos4: "Pos 4 / Roaming Support",
  pos5: "Pos 5 / Hard Support",
};

/** @type {Record<RoleKey, string>} */
const ROLE_SHORT_LABELS = {
  pos1: "Pos 1",
  pos2: "Pos 2",
  pos3: "Pos 3",
  pos4: "Pos 4",
  pos5: "Pos 5",
};

/**
 * OpenDota lane_role -> RoleKey eşlemesi.
 * OpenDota core/support ayrımı yaptığı için pos4/pos5 kesin ayrılamaz;
 * is_roaming bilgisi varsa provider tarafında düzeltilir.
 * @type {Record<number, RoleKey>}
 */
const LANE_ROLE_TO_ROLE_KEY = {
  1: "pos1",
  2: "pos2",
  3: "pos3",
  4: "pos5",
};

/** @type {Record<RoleKey, "core"|"support">} */
const ROLE_GROUP = {
  pos1: "core",
  pos2: "core",
  pos3: "core",
  pos4: "support",
  pos5: "support",
};

/**
 * @param {unknown} value
 * @returns {RoleKey|""}
 */
function normalizeRoleKey(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (ROLE_KEYS.includes(/** @type {RoleKey} */ (raw))) {
    return /** @type {RoleKey} */ (raw);
  }
  const aliases = {
    carry: "pos1",
    safelane: "pos1",
    1: "pos1",
    mid: "pos2",
    midlane: "pos2",
    2: "pos2",
    offlane: "pos3",
    off: "pos3",
    3: "pos3",
    roamer: "pos4",
    roaming: "pos4",
    4: "pos4",
    support: "pos5",
    hardsupport: "pos5",
    5: "pos5",
  };
  const mapped = aliases[raw];
  return mapped ? /** @type {RoleKey} */ (mapped) : "";
}

/** Dota rank madalyalari (rank_tier'in ilk hanesi). */
const RANK_MEDAL_NAMES = [
  "Uncalibrated",
  "Herald",
  "Guardian",
  "Crusader",
  "Archon",
  "Legend",
  "Ancient",
  "Divine",
  "Immortal",
];

const IMMORTAL_MEDAL = 8;

/**
 * rank_tier kodunu (ornek 54) madalya + yildiza cevirir.
 *
 * @param {unknown} rankTier
 * @param {{ leaderboardRank?: number|null, provider?: string, fetchedAt?: string }} [meta]
 * @returns {import("./player-types").PlayerRank|null}
 */
function resolveRankTier(rankTier, meta = {}) {
  const tier = Number(rankTier);
  if (!Number.isFinite(tier) || tier <= 0) {
    return null;
  }

  const medal = Math.floor(tier / 10);
  const stars = tier % 10;
  if (medal < 1 || medal >= RANK_MEDAL_NAMES.length) {
    return null;
  }

  const medalName = RANK_MEDAL_NAMES[medal];
  const leaderboardRank = Number(meta.leaderboardRank);
  const hasLeaderboard =
    Number.isFinite(leaderboardRank) && leaderboardRank > 0;

  // Immortal'da yildiz yoktur; varsa leaderboard sirasi gosterilir.
  const label =
    medal === IMMORTAL_MEDAL
      ? hasLeaderboard
        ? `${medalName} #${leaderboardRank}`
        : medalName
      : stars > 0
        ? `${medalName} ${stars}`
        : medalName;

  return {
    tier,
    medal,
    stars: medal === IMMORTAL_MEDAL ? 0 : stars,
    label,
    leaderboardRank: hasLeaderboard ? leaderboardRank : null,
    provider: String(meta.provider || ""),
    fetchedAt: String(meta.fetchedAt || new Date().toISOString()),
  };
}

export {
  IMMORTAL_MEDAL,
  RANK_MEDAL_NAMES,
  resolveRankTier,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  ROLE_GROUP,
  LANE_ROLE_TO_ROLE_KEY,
  normalizeRoleKey,
};
