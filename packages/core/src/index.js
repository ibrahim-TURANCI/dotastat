/**
 * @dotastat/core — paylasilan alan mantigi.
 *
 * Bu paket saf JavaScript'tir: `fs`, `path`, Express, Electron gibi ortama
 * bagli hicbir sey kullanmaz. Bu sayede ayni kod uc yerde birden calisir:
 *
 *   - packages/web        (tarayici, Vite)
 *   - netlify/functions   (Netlify Functions, Node)
 *   - packages/desktop    (Electron ana sureci, Node)
 *
 * Yan etkili is (ag istegi onbellekleme, dosyaya yazma, oturum) her zaman
 * cagiran katmanin sorumlulugudur.
 */

// --- Kahramanlar -----------------------------------------------------------
export {
  HERO_ATTRIBUTES,
  HERO_ATTRIBUTE_LABELS,
  HERO_CDN,
  heroDisplayName,
  heroIdFromKey,
  heroImageUrl,
  heroKeyFromId,
  heroPrimaryAttribute,
  heroRoleProfile,
  normalizeHeroKey,
} from "./heroes/hero-names.js";

// --- Oyuncu tipleri ve normalizasyon ---------------------------------------
export {
  LANE_ROLE_TO_ROLE_KEY,
  RANK_MEDAL_NAMES,
  ROLE_GROUP,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  normalizeRoleKey,
  resolveRankTier,
} from "./players/player-types.js";

export {
  buildPlayerSlug,
  buildSynergyId,
  normalizePlayer,
  normalizeSynergy,
} from "./players/player-normalizer.js";

// --- Roster ----------------------------------------------------------------
export {
  findRosterPlayer,
  isCatalogAdmin,
  listAllRoster,
  listRoster,
  listSynergies,
  listSynergiesForPlayer,
  toAccountId,
  toSteamId64,
} from "./players/roster.js";

// --- Degerlendirme motorlari ------------------------------------------------
export {
  BENCHMARKS,
  MAX_PERFORMANCE_RANK,
  MIN_PERFORMANCE_RANK,
  ROLE_SOURCE_LABELS,
  evaluateMatchPlayer,
  evaluateMatches,
  resolveEvaluationRole,
  resolveHeroTier,
  resolveRoleFit,
  summarizeForm,
} from "./players/performance-evaluation-engine.js";

export {
  evaluateTeam,
  expectedPerformanceForRole,
  resolveRoleFitLevel,
  suggestLineup,
} from "./players/team-evaluation-engine.js";

export {
  FORM_WINDOW,
  buildPlayerEvaluation,
  resolveEffectivePotential,
  toRosterCard,
} from "./players/evaluation.js";

// --- Hero havuzu (mac verisinden turetilir) ---------------------------------
export {
  buildHeroPool,
  buildPreferredHeroes,
  buildRecommendedHeroes,
  buildSignatureHeroes,
  buildStyleVector,
  buildWeakHeroes,
  shrunkWinRate,
} from "./players/hero-pool.js";

// --- MMR gecmisi (masaustu tarafindan beslenir) -----------------------------
export {
  approximateMmrFromRank,
  attributeMmrToMatches,
  latestMmr,
  mergeMmrSamples,
  MMR_PER_STAR,
  rankProgress,
  resolveRankProgress,
  MMR_MATCH_WINDOW_MS,
  toMmrChanges,
} from "./players/mmr-history.js";

// --- Donem siralamasi (Hafta / Ay) ------------------------------------------
export {
  BASELINE_WINDOW_FACTOR,
  BASELINE_WINDOW_MS,
  DEFAULT_PERIOD,
  ESTIMATED_MMR_PER_MATCH,
  PERIODS,
  PERIOD_HERO_COUNT,
  WEEKLY_WINDOW_MS,
  buildWeeklyEntry,
  buildWeeklyScoreboard,
  isAllTimePeriod,
  resolvePeriod,
  withPeriodSummary,
} from "./players/weekly-score.js";

export {
  HERO_PERFORMANCE_TTL_MS,
  MATCH_FETCH_SIZE,
  MATCH_TTL_MS,
  PROFILE_TTL_MS,
  createPlayerDataService,
  mergeMatchHistory,
} from "./players/player-data-service.js";

// --- Mac kadrosu ve Genel sekmesi ozeti (onbellekten, ag istegi yok) ---------
export { buildMatchSquads } from "./players/match-squads.js";
export { buildMatchDetailView } from "./players/match-detail.js";
export {
  buildPlayerOverview,
  OVERVIEW_RECENT_COUNT,
} from "./players/player-overview.js";

// --- Veri kaynaklari --------------------------------------------------------
export { createOpenDotaClient, PROVIDER_NAME } from "./providers/opendota.js";
export { createStratzClient } from "./providers/stratz.js";
export { createProviderChain } from "./providers/provider-chain.js";
export {
  isRateLimitError,
  NOT_CONFIGURED,
  RATE_LIMIT,
  UNAVAILABLE,
} from "./providers/provider-errors.js";
export { buildStatsFromMatches } from "./providers/match-stats.js";

// --- Draft ------------------------------------------------------------------
export {
  getDraftHeroProfile,
  getDraftMetrics,
  scoreDraftPick,
  summarizeTeamDraft,
} from "./draft/draft-analyzer.js";

export {
  buildDraftAdvice,
  countersOf,
  heroSlots,
  resolveDraftStage,
} from "./draft/draft-advisor.js";

// --- Canli mac (GSI) --------------------------------------------------------
export { normalizeGsiPayload } from "./gsi/normalize-gsi.js";
export {
  buildLiveMatchContext,
  isLiveMatchFresh,
  selectLiveStateForViewer,
  LIVE_MATCH_TTL_MS,
} from "./gsi/match-context.js";
export {
  applyOverwolfSnapshot,
  isSnapshotForLiveState,
  mergeLiveStateGroup,
  mergeLiveStatesByMatch,
  mergePlayerLists,
} from "./gsi/merge-live.js";

// --- Canli mac item tavsiyesi ve takim analizi -------------------------------
export {
  buildLiveItemAdvice,
  buildPlayerItemAdvice,
  buildTeamAnalysis,
  itemDisplayName,
  itemIconUrl,
  ownedItems,
  resolveDataLevel,
  teamRoleBars,
  ADVICE_QUOTA,
  GROUP_LABELS,
  RADAR_AXES,
  TEAM_ATTRIBUTES,
} from "./live/item-advice.js";
export {
  isRetiredItem,
  normalizeItemKey,
  ITEM_KEY_ALIASES,
  RETIRED_ITEMS,
} from "./live/item-keys.js";

// --- Kademeli item tavsiyesi (once ara parca, gec oyunda kucuk item yok) -----
export {
  hasGameTime,
  isLateGame,
  isSmallItem,
  itemComponentsOf,
  nextBuildStep,
  ownedWithComponents,
  LATE_GAME_SECONDS,
  SMALL_ITEM_COST,
  STEP_MIN_COST,
} from "./live/item-progression.js";

// --- Envanteri gorunmeyen hero'lar icin tahmini envanter ---------------------
export {
  goldPerMinute,
  itemBudget,
  predictInventory,
  GOLD_PER_MINUTE,
  MAX_PREDICTED,
} from "./live/predicted-items.js";

// --- Rakip kompozisyonundaki tehditler --------------------------------------
export {
  detectThreats,
  heroThreats,
  threatAnswers,
  THREATS,
} from "./live/threats.js";

// --- Hero ozellikleri ("Özellikler" kutucuklari) ----------------------------
export {
  heroTraitSeed,
  normalizeTraitList,
  HERO_TRAITS,
  TRAIT_BY_KEY,
  TRAIT_KEYS,
  TRAIT_LABELS,
  TRAIT_TOOLTIPS,
} from "./heroes/hero-traits.js";

// --- Hero / item arama (duzenleme ekranindaki otomatik tamamlama) ------------
export { exactHeroKey, searchHeroes, searchItems } from "./heroes/search.js";

// --- Hero tavsiye katalogu ("Tavsiyeleri yonet") -----------------------------
export {
  heroCatalog,
  heroKeys,
  changesHeroSeed,
  editedHeroKeys,
  heroPlansFromItemPlans,
  heroRecord,
  heroSeed,
  isKnownHero,
  sameHeroOverride,
  normalizeHeroOverride,
  normalizeHeroPlans,
  HERO_LIST_FIELDS,
  LANE_ROLES,
  LANE_ROLE_LABELS,
  MAX_LIST_LENGTH,
  ROLE_VALUE_KEYS,
  ROLE_VALUE_LABELS,
} from "./heroes/hero-catalog.js";

// --- Overwolf / DotaPlus (istege bagli ek kaynak) ---------------------------
export {
  buildOverwolfSnapshot,
  parseDotaPlusControllerLog,
  parseDotaPlusObjectLog,
  parseLogTimestamp,
  teamFromPlayerIndex,
  teamSlotFromPlayerIndex,
} from "./overwolf/parse-live-log.js";
