/**
 * Oyuncu degerlendirmesinin saf (yan etkisiz) katmani.
 *
 * Girdi: oyuncu profili + ham mac listesi.
 * Cikti: mac bazli Performance Rank degerlendirmeleri, form ozeti, hero
 * havuzu istatistigi ve profil beklentisiyle harmanlanmis "etkin potansiyel".
 *
 * ONEMLI: `performanceRank` ve `performanceProfile` degerleri GERCEK MMR
 * DEGILDIR. Oyuncunun hangi seviyede oynadigina dair tahmindir; arayuzde her
 * zaman bu sekilde etiketlenmelidir.
 */

import {
  evaluateMatches,
  summarizeForm,
} from "./performance-evaluation-engine.js";
import { buildStatsFromMatches } from "../providers/match-stats.js";
import { buildHeroPool } from "./hero-pool.js";

/** Gozlemin profil beklentisini en fazla ne kadar kaydirabilecegi. */
const POTENTIAL_BLEND_MAX_WEIGHT = 0.5;
/** Bu kadar mac sonrasi gozlem tam agirligina ulasir. */
const POTENTIAL_FULL_WEIGHT_SAMPLE = 10;
/** Bu sayinin altinda gozlem potansiyeli kaydirmaz. */
const POTENTIAL_MIN_SAMPLE = 3;

/** Kart uzerindeki form ozeti kac maca bakar. */
export const FORM_WINDOW = 10;

/**
 * Profildeki statik potansiyeli son maclardaki gercek performansa gore kaydirir.
 *
 * Ornek: profil 5000-6000 diyor ama son 10 macin ortalamasi 4200 ise
 * potansiyel asagi ceker. Ornek sayisi arttikca gozlemin agirligi buyur,
 * ancak profil beklentisi tamamen yok sayilmaz (tavan agirlik %50).
 *
 * @param {import("./player-types.js").Player} player
 * @param {ReturnType<typeof summarizeForm>} form
 */
export function resolveEffectivePotential(player, form) {
  const base = player?.performanceProfile?.strongHeroPerformance || {
    min: 0,
    max: 0,
  };
  const baseRange = { min: Number(base.min) || 0, max: Number(base.max) || 0 };
  const observed = Number(form?.averagePerformanceRank || 0);
  const sample = Number(form?.matches || 0);

  const result = {
    min: baseRange.min,
    max: baseRange.max,
    base: baseRange,
    observedAverage: observed,
    sampleSize: sample,
    delta: 0,
    source: "profile",
  };

  if (!observed || sample < POTENTIAL_MIN_SAMPLE || !baseRange.max) {
    return result;
  }

  const center = (baseRange.min + baseRange.max) / 2;
  const weight =
    (Math.min(sample, POTENTIAL_FULL_WEIGHT_SAMPLE) /
      POTENTIAL_FULL_WEIGHT_SAMPLE) *
    POTENTIAL_BLEND_MAX_WEIGHT;
  const shift = Math.round((observed - center) * weight);

  return {
    ...result,
    min: Math.max(0, baseRange.min + shift),
    max: Math.max(0, baseRange.max + shift),
    delta: shift,
    source: "blended",
  };
}

/**
 * Bir oyuncunun mac listesinden tam degerlendirme paketi uretir.
 *
 * @param {Object} input
 * @param {import("./player-types.js").Player} input.player
 * @param {import("./player-types.js").PlayerMatch[]} input.matches
 * @param {Record<string, string>} [input.forcedRoles] matchId -> RoleKey
 * @param {import("./hero-pool.js").HeroPerformanceRow[]} [input.heroPerformance] Tum zamanlar
 * @param {number} [input.formWindow]
 */
export function buildPlayerEvaluation(input) {
  const player = input?.player;
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const forcedRoles = input?.forcedRoles || {};
  const formWindow = Number(input?.formWindow) || FORM_WINDOW;

  // Hero havuzu ONCE turetilir: degerlendirme motoru "bu hero onun imza
  // kahramani mi" sorusunu havuza sorar, dolayisiyla havuzun mac verisinden
  // gelen guncel hali tohum listelerin yerine gecmelidir.
  const heroPool = buildHeroPool({
    lifetime: input?.heroPerformance || [],
    matches,
    player,
  });

  const evaluatedPlayer = withDerivedHeroPool(player, heroPool);
  const evaluations = evaluateMatches({
    player: evaluatedPlayer,
    matches,
    forcedRoles,
  });
  const formMatches = matches.slice(0, formWindow);
  const formEvaluations = evaluations.slice(0, formWindow);
  const form = summarizeForm(formEvaluations, formMatches);

  return {
    player: evaluatedPlayer,
    matches,
    evaluations,
    form,
    heroPool,
    effectivePotential: resolveEffectivePotential(evaluatedPlayer, form),
    stats: buildStatsFromMatches(player?.player_id || "", matches, "opendota"),
  };
}

/**
 * Turetilen hero havuzunu oyuncu profiline yazar.
 *
 * Tohum listeler (`players.seed.js`) tamamen atilmaz: elle girilmis zayif
 * hero notlari gibi bilgiler mac verisinden cikarilamaz, o yuzden turetilen
 * liste ile BIRLESTIRILIR. Turetilen her zaman one gelir.
 *
 * @param {import("./player-types.js").Player} player
 * @param {ReturnType<typeof buildHeroPool>} heroPool
 * @returns {import("./player-types.js").Player}
 */
function withDerivedHeroPool(player, heroPool) {
  if (!player) {
    return player;
  }
  const seed = player.dotaProfile || {};
  const keysOf = (rows) => rows.map((row) => row.hero);
  const merge = (derived, seeded) => [
    ...new Set([...derived, ...(seeded || [])]),
  ];

  return {
    ...player,
    dotaProfile: {
      ...seed,
      signatureHeroes: keysOf(heroPool.signature),
      preferredHeroes: keysOf(heroPool.preferred),
      recommendedHeroes: keysOf(heroPool.recommended),
      // Zayif listesinde tohum veri korunur; elle isaretlenmis bir hero
      // istatistige yansimamis olabilir.
      weakHeroes: merge(keysOf(heroPool.weak), seed.weakHeroes),
      // Eski alan adi geriye donuk uyum icin duruyor (draft-advisor okuyor).
      experimentalHeroes: keysOf(heroPool.recommended),
    },
  };
}

/**
 * Oyuncu kartlari icin hafif ozet (detay sekmeleri olmadan).
 * @param {ReturnType<typeof buildPlayerEvaluation>} evaluation
 */
export function toRosterCard(evaluation) {
  const { player, form, effectivePotential, stats, heroPool } = evaluation;
  return {
    id: player.id,
    name: player.name,
    playerId: player.player_id,
    avatar: player.avatar,
    rank: player.rank,
    primaryRole: player.dotaProfile?.primaryRole || "",
    secondaryRoles: player.dotaProfile?.secondaryRoles || [],
    signatureHeroes: player.dotaProfile?.signatureHeroes || [],
    // Kartta imza kahramanlarin neden imza oldugunu gostermek icin gerekce
    // ve mac sayisi da tasinir.
    signatureDetail: (heroPool?.signature || []).slice(0, 3),
    heroPoolSource: heroPool?.derivedFrom || "",
    form,
    effectivePotential,
    topHeroes: (stats?.heroes || []).slice(0, 5),
  };
}
