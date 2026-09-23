/**
 * Oyuncu detayindaki "Genel" sekmesinin VERIDEN uretilen ozeti.
 *
 * NEDEN: Genel sekmesi yalnizca elle yazilmis karakter notlarini gosteriyordu;
 * notlar yeni maclar geldikce degismiyor ve "bu hafta ne oluyor" sorusuna hic
 * cevap vermiyordu. Bu modul mac listesinden dort kisa ozet (Performans, Hero
 * Havuzu, Sinerji, Son 5 Mac) ve bunlara bagli tavsiyeler uretir.
 *
 * DETERMINIZM: cikti YALNIZCA girdiden turer — ayni veri her zaman ayni
 * tavsiyeleri, ayni sirada ve ayni `key` ile uretir. Veri degismediyse yeni
 * tavsiye cikmaz; `signature` de degismez. Arayuz "yeni" rozetini bu imzaya
 * ve tavsiye anahtarlarina bakarak verir (bkz. PlayerDetail.jsx).
 *
 * SAF FONKSIYON: depo okumaz, saat okumaz, ag istegi yapmaz.
 */

import { heroDisplayName } from "../heroes/hero-names.js";

/** "Son maclar" ozetinin kapsadigi mac sayisi. */
export const OVERVIEW_RECENT_COUNT = 5;
/** Hero / arkadas egilimine bakilan pencere. */
const TREND_WINDOW = 20;
/** Bir hero ya da arkadas icin yorum yapmadan once gereken en az mac. */
const MIN_SAMPLE = 3;
/** Performance Rank degisiminin "anlamli" sayildigi fark. */
const RANK_DELTA_MIN = 150;
/** En fazla gosterilen tavsiye sayisi. */
const MAX_TIPS = 4;

/**
 * @param {Object} input
 * @param {Array<Record<string, any>>} [input.matches] Yeniden eskiye sirali
 * @param {Array<Record<string, any>>} [input.evaluations]
 * @param {Record<string, { members: Array<Record<string, any>> }>} [input.squads]
 *   bkz. match-squads.js; yoksa sinerji yalnizca "veri yok" der
 * @returns {{
 *   signature: string,
 *   hasData: boolean,
 *   performance: Record<string, any>,
 *   heroPool: Record<string, any>,
 *   synergy: Record<string, any>,
 *   recent: Record<string, any>,
 *   tips: Array<{ key: string, text: string, tone: "good"|"bad"|"warn" }>
 * }}
 */
export function buildPlayerOverview(input = {}) {
  const matches = (Array.isArray(input.matches) ? input.matches : []).filter(
    (row) => row && row.matchId,
  );
  const evaluations = Array.isArray(input.evaluations) ? input.evaluations : [];
  const squads =
    input.squads && typeof input.squads === "object" ? input.squads : {};

  const rankByMatch = new Map(
    evaluations
      .filter((row) => row && row.matchId)
      .map((row) => [String(row.matchId), row]),
  );

  const recentRows = matches.slice(0, OVERVIEW_RECENT_COUNT);
  const window = matches.slice(0, TREND_WINDOW);

  const performance = summarizePerformance(matches, rankByMatch);
  const heroPool = summarizeHeroes(window);
  const synergy = summarizeSynergy(window, squads);
  const recent = summarizeRecent(recentRows, rankByMatch, squads);

  /** @type {Array<{ key: string, text: string, tone: "good"|"bad"|"warn", weight: number }>} */
  const tips = [];
  const tip = (key, text, tone, weight) =>
    tips.push({ key, text, tone, weight });

  // --- Seri ------------------------------------------------------------------
  if (recent.streak.count >= 3) {
    if (recent.streak.type === "loss") {
      const best = heroPool.best;
      tip(
        "streak-loss-" + recent.streak.count,
        `Üst üste ${recent.streak.count} mağlubiyet. Kısa bir mola ver` +
          (best
            ? `; dönünce güvendiğin ${heroDisplayName(best.hero)} ile başla.`
            : "."),
        "bad",
        90,
      );
    } else {
      tip(
        "streak-win-" + recent.streak.count,
        `${recent.streak.count} maçlık galibiyet serisi — aynı hero havuzuyla devam.`,
        "good",
        70,
      );
    }
  }

  // --- Performans egilimi ------------------------------------------------------
  if (
    performance.delta !== null &&
    Math.abs(performance.delta) >= RANK_DELTA_MIN
  ) {
    if (performance.delta < 0) {
      tip(
        "perf-down",
        `Son ${OVERVIEW_RECENT_COUNT} maçın Performance Rank ortalaması öncekilerden ${Math.abs(performance.delta)} düşük.`,
        "warn",
        80,
      );
    } else {
      tip(
        "perf-up",
        `Performance Rank son ${OVERVIEW_RECENT_COUNT} maçta ${performance.delta} yükseldi — form iyi.`,
        "good",
        60,
      );
    }
  }

  // --- Tekrarlayan hata --------------------------------------------------------
  const mistake = recurringMistake(matches.slice(0, 10), rankByMatch);
  if (mistake) {
    tip(
      "mistake-" + slug(mistake.text),
      `Son maçlarda ${mistake.count} kez tekrar etti: ${mistake.text}`,
      "warn",
      75,
    );
  }

  // --- Olum ------------------------------------------------------------------
  if (recent.matches.length >= 3 && recent.avgDeaths >= 8) {
    tip(
      "deaths-high",
      `Son maçlarda ortalama ${recent.avgDeaths} ölüm; güvenli pozisyon ve BKB/kaçış zamanlamasına dikkat.`,
      "warn",
      65,
    );
  }

  // --- Hero havuzu -----------------------------------------------------------
  if (heroPool.worst) {
    tip(
      "hero-weak-" + heroPool.worst.hero,
      `${heroDisplayName(heroPool.worst.hero)} son ${heroPool.worst.matches} maçta ${heroPool.worst.wins} galibiyet; bir süre başka hero dene.`,
      "bad",
      55,
    );
  }
  if (heroPool.best) {
    tip(
      "hero-strong-" + heroPool.best.hero,
      `${heroDisplayName(heroPool.best.hero)} ile %${Math.round(heroPool.best.winRate * 100)} kazanıyor (${heroPool.best.matches} maç) — draftta öncelik ver.`,
      "good",
      50,
    );
  }

  // --- Sinerji ---------------------------------------------------------------
  if (synergy.best) {
    tip(
      "partner-strong-" + synergy.best.id,
      `${synergy.best.name} ile birlikte %${Math.round(synergy.best.winRate * 100)} (${synergy.best.matches} maç) — birlikte kuyruğa girin.`,
      "good",
      45,
    );
  }
  if (synergy.worst) {
    tip(
      "partner-weak-" + synergy.worst.id,
      `${synergy.worst.name} ile birlikte ${synergy.worst.matches} maçta ${synergy.worst.wins} galibiyet; lane/rol dağılımını konuşun.`,
      "warn",
      40,
    );
  }

  // Ayni anahtar iki kez uretilmez; agirliga gore siralanir, esitlikte
  // anahtar sirasi kullanilir ki ekranda yer degistirmesin.
  const seen = new Set();
  const finalTips = tips
    .filter((row) => (seen.has(row.key) ? false : seen.add(row.key)))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, MAX_TIPS)
    .map(({ key, text, tone }) => ({ key, text, tone }));

  return {
    // Imza: en yeni mac + mac sayisi + degerlendirme sayisi. Yeni mac gelmeden
    // degismez, dolayisiyla "yeni tavsiye" rozeti de gereksiz yere yanmaz.
    signature: [
      matches[0]?.matchId || "",
      matches.length,
      evaluations.length,
      Object.keys(squads).length,
    ].join(":"),
    hasData: matches.length > 0,
    performance,
    heroPool,
    synergy,
    recent,
    tips: finalTips,
  };
}

/**
 * @param {Array<Record<string, any>>} matches
 * @param {Map<string, Record<string, any>>} rankByMatch
 */
function summarizePerformance(matches, rankByMatch) {
  const ranks = matches
    .map((row) => Number(rankByMatch.get(String(row.matchId))?.performanceRank))
    .map((value) => (Number.isFinite(value) && value > 0 ? value : null));

  const recent = ranks.slice(0, OVERVIEW_RECENT_COUNT).filter(isNumber);
  const before = ranks
    .slice(OVERVIEW_RECENT_COUNT, TREND_WINDOW)
    .filter(isNumber);

  const recentAvg = average(recent);
  const beforeAvg = average(before);
  const delta =
    recentAvg !== null && beforeAvg !== null && before.length >= MIN_SAMPLE
      ? Math.round(recentAvg - beforeAvg)
      : null;

  const window = matches.slice(0, TREND_WINDOW);
  const wins = window.filter((row) => row.result === "win").length;

  return {
    recentAvgRank: recentAvg === null ? null : Math.round(recentAvg),
    previousAvgRank: beforeAvg === null ? null : Math.round(beforeAvg),
    delta,
    trend:
      delta === null
        ? "flat"
        : delta >= RANK_DELTA_MIN
          ? "up"
          : delta <= -RANK_DELTA_MIN
            ? "down"
            : "flat",
    matches: window.length,
    wins,
    winRate: window.length ? round2(wins / window.length) : 0,
  };
}

/**
 * @param {Array<Record<string, any>>} window
 */
function summarizeHeroes(window) {
  /** @type {Map<string, { hero: string, matches: number, wins: number }>} */
  const byHero = new Map();
  for (const row of window) {
    const hero = String(row.hero || "");
    if (!hero) {
      continue;
    }
    const entry = byHero.get(hero) || { hero, matches: 0, wins: 0 };
    entry.matches += 1;
    entry.wins += row.result === "win" ? 1 : 0;
    byHero.set(hero, entry);
  }

  const rows = [...byHero.values()]
    .map((row) => ({ ...row, winRate: round2(row.wins / row.matches) }))
    .sort(
      (a, b) =>
        b.matches - a.matches ||
        b.winRate - a.winRate ||
        a.hero.localeCompare(b.hero),
    );

  const sampled = rows.filter((row) => row.matches >= MIN_SAMPLE);
  const best =
    [...sampled]
      .filter((row) => row.winRate >= 0.6)
      .sort((a, b) => b.winRate - a.winRate || b.matches - a.matches)[0] ||
    null;
  const worst =
    [...sampled]
      .filter((row) => row.winRate <= 0.34)
      .sort((a, b) => a.winRate - b.winRate || b.matches - a.matches)[0] ||
    null;

  return {
    unique: rows.length,
    matches: window.length,
    top: rows.slice(0, 3),
    best,
    worst,
  };
}

/**
 * @param {Array<Record<string, any>>} window
 * @param {Record<string, { members: Array<Record<string, any>> }>} squads
 */
function summarizeSynergy(window, squads) {
  /** @type {Map<string, { id: string, name: string, matches: number, wins: number }>} */
  const partners = new Map();
  let known = 0;
  let solo = { matches: 0, wins: 0 };
  let stack = { matches: 0, wins: 0 };

  for (const row of window) {
    const squad = squads[String(row.matchId)];
    if (!squad) {
      continue;
    }
    known += 1;
    const win = row.result === "win" ? 1 : 0;
    const allies = (squad.members || []).filter(
      (member) => member.team === "ally" && !member.self,
    );
    const bucket = allies.length ? stack : solo;
    bucket.matches += 1;
    bucket.wins += win;
    for (const member of allies) {
      const entry = partners.get(member.id) || {
        id: String(member.id),
        name: String(member.name || member.id),
        matches: 0,
        wins: 0,
      };
      entry.matches += 1;
      entry.wins += win;
      partners.set(member.id, entry);
    }
  }

  const rows = [...partners.values()]
    .map((row) => ({ ...row, winRate: round2(row.wins / row.matches) }))
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));

  const sampled = rows.filter((row) => row.matches >= MIN_SAMPLE);
  const best =
    [...sampled]
      .filter((row) => row.winRate >= 0.6)
      .sort((a, b) => b.winRate - a.winRate || b.matches - a.matches)[0] ||
    null;
  const worst =
    [...sampled]
      .filter((row) => row.winRate <= 0.34)
      .sort((a, b) => a.winRate - b.winRate || b.matches - a.matches)[0] ||
    null;

  return {
    known,
    partners: rows.slice(0, 4),
    best,
    worst,
    solo: {
      ...solo,
      winRate: solo.matches ? round2(solo.wins / solo.matches) : 0,
    },
    stack: {
      ...stack,
      winRate: stack.matches ? round2(stack.wins / stack.matches) : 0,
    },
  };
}

/**
 * @param {Array<Record<string, any>>} rows
 * @param {Map<string, Record<string, any>>} rankByMatch
 * @param {Record<string, { members: Array<Record<string, any>>, allies?: number }>} squads
 */
function summarizeRecent(rows, rankByMatch, squads) {
  const wins = rows.filter((row) => row.result === "win").length;

  let streak = { type: rows[0]?.result === "win" ? "win" : "loss", count: 0 };
  for (const row of rows) {
    if ((row.result === "win" ? "win" : "loss") !== streak.type) {
      break;
    }
    streak.count += 1;
  }
  if (!rows.length) {
    streak = { type: "none", count: 0 };
  }

  const kills = sum(rows, "kills");
  const deaths = sum(rows, "deaths");
  const assists = sum(rows, "assists");

  return {
    matches: rows.map((row) => ({
      matchId: String(row.matchId),
      hero: String(row.hero || ""),
      result: row.result === "win" ? "win" : "loss",
      kills: Number(row.kills || 0),
      deaths: Number(row.deaths || 0),
      assists: Number(row.assists || 0),
      performanceRank:
        Number(rankByMatch.get(String(row.matchId))?.performanceRank) || null,
      stack: Number(squads[String(row.matchId)]?.allies) || 0,
    })),
    wins,
    losses: rows.length - wins,
    streak,
    avgKda: rows.length ? round2((kills + assists) / Math.max(1, deaths)) : 0,
    avgDeaths: rows.length ? Math.round((deaths / rows.length) * 10) / 10 : 0,
  };
}

/**
 * Son maclarin degerlendirmelerinde en sik gecen hata metni.
 * @param {Array<Record<string, any>>} rows
 * @param {Map<string, Record<string, any>>} rankByMatch
 */
function recurringMistake(rows, rankByMatch) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const row of rows) {
    const evaluation = rankByMatch.get(String(row.matchId));
    for (const text of new Set(evaluation?.mistakes || [])) {
      const value = String(text || "").trim();
      if (value) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
  }
  const top = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  return top && top[1] >= MIN_SAMPLE ? { text: top[0], count: top[1] } : null;
}

/** @param {unknown} value */
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** @param {number[]} values */
function average(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

/** @param {number} value */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {Array<Record<string, any>>} rows
 * @param {string} field
 */
function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

/** @param {string} text */
function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9ığüşöç]+/g, "-")
    .slice(0, 40);
}
