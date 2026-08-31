/**
 * Haftanin Kazanani / Kaybedeni tablosu.
 *
 * SORU: "son 7 gunde kim iyi gitti, kim kotu gitti" — ve bunun tek bir maclik
 * sansla cevaplanmamasi.
 *
 * Bu yuzden siralama dort olcutun BIRLESIMIDIR:
 *   1. Gercek MMR degisimi   (olculemiyorsa mac sonucundan tahmin edilir)
 *   2. Galibiyet/maglubiyet dengesi
 *   3. Performance Rank degisimi (bu haftaki ortalama vs. onceki donem)
 *   4. Oynanan mac sayisi
 *
 * ORNEK SAYISI AYRI BIR OLCUT DEGIL, HEPSININ CARPANIDIR: 1 mac oynayip
 * kazanan biri haftanin birincisi olamaz, cunku basari kismi `confidence`
 * ile carpilir (1 macta 0.2, 10 macta 0.71). Ayrica dogrudan bir hacim
 * bonusu/cezasi vardir — az oynayan ortalamanin altinda kalir.
 *
 * Modul SAFTIR: saat okumaz (`now` disaridan gelir), ag istegi yapmaz.
 */

import { attributeMmrToMatches, resolveRankProgress } from "./mmr-history.js";
import { shrunkWinRate } from "./hero-pool.js";

/** Tablo kac gunluk pencereye bakar. */
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Performance Rank degisiminin kiyaslandigi gecmis donem.
 *
 * Haftanin ortalamasi, ondan ONCEKI 21 gunun ortalamasiyla kiyaslanir. Daha
 * uzun bir taban aliniyor cunku tek bir haftanin ortalamasi 3-4 macla
 * savruluyor ve "degisim" olcutu gurultuye donusuyor.
 */
export const BASELINE_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * MMR okunamayan maclarda mac basina varsayilan degisim.
 *
 * Dota'da tek maclik MMR degisimi 20-30 bandindadir. Kurulumu yapmamis
 * oyuncular icin (ve kurulum yapmis olsa da uygulama kapaliyken oynanan
 * maclar icin) bu deger kullanilir; sonuc `mmrSource` ile isaretlenir.
 */
export const ESTIMATED_MMR_PER_MATCH = 25;

/**
 * `confidence` egrisinin onceligi: bu kadar "hayali mac" eklenir.
 *
 * 1 mac -> 0.20, 4 mac -> 0.50, 10 mac -> 0.71, 20 mac -> 0.83.
 */
const CONFIDENCE_PRIOR = 4;

/** Hacim bonusunun tavana ulastigi mac sayisi. */
const VOLUME_FULL_MATCHES = 12;

/** Puan agirliklari (toplami, guven 1 iken +-80'e denk gelir). */
const WEIGHTS = {
  mmr: 34,
  win: 26,
  performance: 20,
  /** Hacim +-6 puan oynatir; tek basina siralamayi cevirmez. */
  volume: 12,
};

/** Bu MMR degisimi tam puan sayilir (haftalik ~+-300). */
const MMR_FULL_SCALE = 300;
/** Bu Performance Rank degisimi tam puan sayilir. */
const PERFORMANCE_FULL_SCALE = 400;

/** Nötr puan; herkes buradan baslar. */
const BASE_SCORE = 50;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {unknown} value
 * @returns {number} epoch ms; cozulemezse 0
 */
function timeOf(value) {
  const at = new Date(value || 0).getTime();
  return Number.isFinite(at) && at > 0 ? at : 0;
}

/**
 * @param {Array<Record<string, any>>} evaluations
 * @param {string[]} matchIds
 * @returns {number} ortalama Performance Rank; hic yoksa 0
 */
function averagePerformanceRank(evaluations, matchIds) {
  const wanted = new Set(matchIds);
  const rows = evaluations.filter((row) => wanted.has(String(row?.matchId)));
  if (!rows.length) {
    return 0;
  }
  const total = rows.reduce(
    (sum, row) => sum + (Number(row?.performanceRank) || 0),
    0,
  );
  return Math.round(total / rows.length);
}

/**
 * Bir oyuncunun haftalik ozeti.
 *
 * @param {Object} input
 * @param {Record<string, any>} input.player
 * @param {Array<Record<string, any>>} [input.matches]      En yeni once
 * @param {Array<Record<string, any>>} [input.evaluations]  matchId ile eslesir
 * @param {Array<{ at: string, mmr: number }>} [input.samples]
 * @param {number} [input.now] epoch ms
 * @returns {Record<string, any>}
 */
export function buildWeeklyEntry(input) {
  const player = input?.player || {};
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const evaluations = Array.isArray(input?.evaluations)
    ? input.evaluations
    : [];
  const now = Number(input?.now) || Date.now();
  const since = now - WEEKLY_WINDOW_MS;
  const baselineSince = now - BASELINE_WINDOW_MS;

  const weekly = matches.filter((row) => timeOf(row?.startedAt) >= since);
  const baseline = matches.filter((row) => {
    const at = timeOf(row?.startedAt);
    return at > 0 && at < since && at >= baselineSince;
  });

  const wins = weekly.filter((row) => row?.result === "win").length;
  const losses = weekly.length - wins;

  // MMR: olculebilen maclarda GERCEK degisim, digerlerinde mac basina tahmin.
  // Ikisi ayri sayilir ki arayuz "olculdu / kismi / tahmin" diyebilsin.
  const mmrByMatch = attributeMmrToMatches({
    matches: weekly,
    samples: input?.samples || [],
  });
  let measuredDelta = 0;
  let measuredMatches = 0;
  let estimatedDelta = 0;

  for (const row of weekly) {
    const change = mmrByMatch[row.matchId];
    if (change) {
      measuredDelta += Number(change.delta) || 0;
      measuredMatches += 1;
      continue;
    }
    estimatedDelta +=
      (row?.result === "win" ? 1 : -1) * ESTIMATED_MMR_PER_MATCH;
  }

  const mmrDelta = measuredDelta + estimatedDelta;
  const mmrSource = !weekly.length
    ? "none"
    : measuredMatches === weekly.length
      ? "measured"
      : measuredMatches > 0
        ? "partial"
        : "estimated";

  const weeklyPerformanceRank = averagePerformanceRank(
    evaluations,
    weekly.map((row) => String(row.matchId)),
  );
  const baselinePerformanceRank = averagePerformanceRank(
    evaluations,
    baseline.map((row) => String(row.matchId)),
  );
  const hasBaseline = baselinePerformanceRank > 0 && weeklyPerformanceRank > 0;
  const performanceDelta = hasBaseline
    ? weeklyPerformanceRank - baselinePerformanceRank
    : 0;

  // --- Puan ---------------------------------------------------------------
  //
  // Basari kismi (MMR + galibiyet + performans) guvenle carpilir; hacim
  // bonusu ayri durur cunku "az oynadi" bilgisinin kendisi bir sonuctur.
  const confidence = weekly.length / (weekly.length + CONFIDENCE_PRIOR);

  const mmrPoints = clamp(mmrDelta / MMR_FULL_SCALE, -1, 1) * WEIGHTS.mmr;
  const winPoints =
    clamp((shrunkWinRate(wins, weekly.length) - 0.5) * 2, -1, 1) * WEIGHTS.win;
  const performancePoints = hasBaseline
    ? clamp(performanceDelta / PERFORMANCE_FULL_SCALE, -1, 1) *
      WEIGHTS.performance
    : 0;
  const volumePoints =
    (Math.min(weekly.length / VOLUME_FULL_MATCHES, 1) - 0.5) * WEIGHTS.volume;

  const score = weekly.length
    ? BASE_SCORE +
      confidence * (mmrPoints + winPoints + performancePoints) +
      volumePoints
    : 0;

  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar || "",
    rank: player.rank || null,
    primaryRole: player.dotaProfile?.primaryRole || "",
    /**
     * Su anki MMR. Kurulumu yapmis oyuncuda OLCULEN deger, digerlerinde
     * madalyadan turetilmis tahmin (`approximate: true`).
     */
    mmrProgress: resolveRankProgress({
      samples: input?.samples || [],
      rank: player.rank || null,
    }),

    matches: weekly.length,
    wins,
    losses,
    winRate: weekly.length ? Number((wins / weekly.length).toFixed(4)) : 0,
    form: weekly.map((row) => (row?.result === "win" ? "win" : "loss")),

    mmrDelta: Math.round(mmrDelta),
    mmrSource,
    measuredMatches,

    performanceRank: weeklyPerformanceRank,
    baselinePerformanceRank,
    performanceDelta: Math.round(performanceDelta),
    hasBaseline,

    /** Maci olmayan oyuncu siralamaya girmez; ayri listelenir. */
    ranked: weekly.length > 0,
    score: Number(score.toFixed(1)),
    breakdown: {
      confidence: Number(confidence.toFixed(3)),
      mmr: Number(mmrPoints.toFixed(1)),
      win: Number(winPoints.toFixed(1)),
      performance: Number(performancePoints.toFixed(1)),
      volume: Number(volumePoints.toFixed(1)),
    },
  };
}

/**
 * Kadronun tamami icin haftalik siralama.
 *
 * @param {Object} input
 * @param {Array<Object>} input.entries `buildWeeklyEntry` girdileri
 * @param {number} [input.now] epoch ms
 * @returns {{
 *   since: string, now: string, windowDays: number,
 *   rows: Array<Record<string, any>>,
 *   winner: Record<string, any>|null,
 *   loser: Record<string, any>|null,
 *   idle: Array<Record<string, any>>
 * }}
 */
export function buildWeeklyScoreboard(input) {
  const now = Number(input?.now) || Date.now();
  const rows = (Array.isArray(input?.entries) ? input.entries : [])
    .map((entry) => buildWeeklyEntry({ ...entry, now }))
    .filter((row) => row.id);

  const ranked = rows
    .filter((row) => row.ranked)
    // Esitlikte cok oynayan one gecer: ayni puanda daha fazla mac daha
    // guvenilir bir sonuctur.
    .sort((a, b) => b.score - a.score || b.matches - a.matches);
  const idle = rows.filter((row) => !row.ranked);

  ranked.forEach((row, index) => {
    row.position = index + 1;
  });

  return {
    since: new Date(now - WEEKLY_WINDOW_MS).toISOString(),
    now: new Date(now).toISOString(),
    windowDays: Math.round(WEEKLY_WINDOW_MS / (24 * 60 * 60 * 1000)),
    rows: [...ranked, ...idle],
    // Kazanan ve kaybeden yalnizca EN AZ IKI siralanan oyuncu varken
    // anlamlidir; tek kisi hem birinci hem sonuncu olmaz.
    winner: ranked.length >= 2 ? ranked[0] : null,
    loser: ranked.length >= 2 ? ranked[ranked.length - 1] : null,
    idle,
  };
}
