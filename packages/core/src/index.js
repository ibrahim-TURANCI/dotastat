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
  HERO_CDN,
  heroDisplayName,
  heroIdFromKey,
  heroImageUrl,
  heroKeyFromId,
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
  attributeMmrToMatches,
  mergeMmrSamples,
  MMR_MATCH_WINDOW_MS,
  toMmrChanges,
} from "./players/mmr-history.js";

export {
  HERO_PERFORMANCE_TTL_MS,
  MATCH_FETCH_SIZE,
  MATCH_TTL_MS,
  PROFILE_TTL_MS,
  createPlayerDataService,
} from "./players/player-data-service.js";

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
