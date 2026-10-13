/**
 * Oyuncu detayindaki "Sinerji" sekmesinin VERIDEN uretilen hali.
 *
 * NEDEN: Sinerji kartlari tohum veriden (`synergies.seed.js`) elle yazilmis
 * ikili notlari gosteriyordu: yalnizca birkac ikili icin vardi, yeni eklenen
 * oyuncuda hic yoktu ve maclarla celisebiliyordu. Burada her ikili, kadro
 * eslesmesinden (bkz. match-squads.js) — ayni takimda oynanan maclardan —
 * olculur: birlikte kazanma orani, oyuncunun genel oranina gore farki,
 * birlikteyken Performance Rank farki, en verimli rol ve hero ikilileri.
 *
 * DOGRULUK ONCE: `SYNERGY_MIN_MATCHES` altindaki ikililer listelenir ama puan
 * ve yorum almaz. Puan, az macta asiri uclara kacmasin diye 0.5'e dogru
 * cekilmis (Bayes) kazanma oranindan hesaplanir.
 *
 * SAF FONKSIYON: depo okumaz, saat okumaz, ag istegi yapmaz.
 */

import { reliableRoleOf } from "./player-style.js";

/** Puan ve yorum icin gereken en az ortak mac. */
export const SYNERGY_MIN_MATCHES = 3;
/** Kazanma oraninin 0.5'e cekilmesinde kullanilan sanal mac sayisi. */
const PRIOR_MATCHES = 4;
/** Rol / hero ikilisinin yorumlanmasi icin gereken en az mac. */
const PAIR_MIN_MATCHES = 2;
/** Performance Rank farkinin "anlamli" sayildigi esik. */
const RANK_DELTA_MIN = 100;
/** Kazanma orani farkinin "anlamli" sayildigi esik. */
const WIN_DELTA_MIN = 0.1;

/**
 * @typedef {Object} SynergyPair
 * @property {string} selfKey
 * @property {string} partnerKey
 * @property {number} matches
 * @property {number} wins
 * @property {number} winRate
 */

/**
 * @typedef {Object} PartnerSynergy
 * @property {string} id
 * @property {string} name
 * @property {string} avatar
 * @property {number} matches
 * @property {number} wins
 * @property {number} winRate
 * @property {number} winDelta     Oyuncunun genel oranina gore fark
 * @property {number|null} rankWith    Birlikteyken ortalama Performance Rank
 * @property {number|null} rankDelta   Birlikte - ayri
 * @property {number|null} score       0-100; az macta null
 * @property {SynergyPair[]} rolePairs
 * @property {SynergyPair[]} heroPairs
 * @property {string[]} strengths
 * @property {string[]} risks
 */

/**
 * @param {Object} input
 * @param {Array<Record<string, any>>} [input.matches]
 * @param {Array<Record<string, any>>} [input.evaluations]
 * @param {Record<string, { members: Array<Record<string, any>> }>} [input.squads]
 * @param {Record<string, string>} [input.roleLabels] "pos3" -> "Pos 3"
 * @param {(hero: string) => string} [input.heroName]
 * @returns {{
 *   known: number,
 *   overall: { matches: number, wins: number, winRate: number },
 *   partners: PartnerSynergy[]
 * }}
 */
export function buildPlayerSynergy(input = {}) {
  const matches = (Array.isArray(input.matches) ? input.matches : []).filter(
    (row) => row && row.matchId,
  );
  const squads =
    input.squads && typeof input.squads === "object" ? input.squads : {};
  const roleLabel = (role) => input.roleLabels?.[role] || role || "?";
  const heroName = input.heroName || ((hero) => hero);
  const byMatch = new Map(
    (Array.isArray(input.evaluations) ? input.evaluations : [])
      .filter((row) => row && row.matchId)
      .map((row) => [String(row.matchId), row]),
  );

  // Yalnizca kadro eslesmesi bilinen maclar sayilir; aksi halde "ayri"
  // maclar eslesmesi kurulamayan maclarla karisirdi.
  const known = matches.filter((row) => squads[String(row.matchId)]);
  const overallWins = known.filter((row) => row.result === "win").length;
  const overallRate = known.length ? overallWins / known.length : 0.5;

  /** @type {Map<string, { id: string, name: string, avatar: string, rows: Array<{ match: Record<string, any>, member: Record<string, any> }> }>} */
  const partners = new Map();
  for (const match of known) {
    const allies = (squads[String(match.matchId)].members || []).filter(
      (member) => member && member.team === "ally" && !member.self,
    );
    for (const member of allies) {
      const id = String(member.id);
      const entry = partners.get(id) || {
        id,
        name: String(member.name || id),
        avatar: String(member.avatar || ""),
        rows: [],
      };
      entry.rows.push({ match, member });
      partners.set(id, entry);
    }
  }

  const rankOf = (match) =>
    Number(byMatch.get(String(match.matchId))?.performanceRank) || null;
  // Yalnizca pozisyonu gercekten bilinen maclar (istatistik cikarimi her
  // core maci pos1 sayiyor; bkz. player-style.js RELIABLE_ROLE_SOURCES).
  const roleOf = (match) => reliableRoleOf(byMatch.get(String(match.matchId)));

  const rows = [...partners.values()].map((entry) => {
    const together = new Set(
      entry.rows.map((row) => String(row.match.matchId)),
    );
    const wins = entry.rows.filter((row) => row.match.result === "win").length;
    const count = entry.rows.length;
    const winRate = round2(wins / count);
    const rankWith = average(entry.rows.map((row) => rankOf(row.match)));
    const rankWithout = average(
      known
        .filter((row) => !together.has(String(row.matchId)))
        .map((row) => rankOf(row)),
    );
    const rankDelta =
      rankWith !== null && rankWithout !== null
        ? Math.round(rankWith - rankWithout)
        : null;
    const winDelta = round2(winRate - overallRate);

    const rolePairs = pairsOf(entry.rows, (row) => [
      roleOf(row.match),
      String(row.member.role || ""),
    ]);
    const heroPairs = pairsOf(entry.rows, (row) => [
      String(row.match.hero || ""),
      String(row.member.hero || ""),
    ]);

    const sampled = count >= SYNERGY_MIN_MATCHES;
    const score = sampled ? scoreOf(wins, count, rankDelta) : null;

    /** @type {string[]} */
    const strengths = [];
    /** @type {string[]} */
    const risks = [];
    if (sampled) {
      if (winDelta >= WIN_DELTA_MIN) {
        strengths.push(
          `Birlikte %${pct(winRate)} kazanıyorsunuz — genel oranından ${pct(winDelta)} puan yüksek.`,
        );
      } else if (winDelta <= -WIN_DELTA_MIN) {
        risks.push(
          `Birlikte %${pct(winRate)} kazanıyorsunuz — genel oranından ${pct(-winDelta)} puan düşük.`,
        );
      }
      if (rankDelta !== null && rankDelta >= RANK_DELTA_MIN) {
        strengths.push(
          `Birlikteyken Performance Rank ortalaman ${rankDelta} yüksek.`,
        );
      } else if (rankDelta !== null && rankDelta <= -RANK_DELTA_MIN) {
        risks.push(
          `Birlikteyken Performance Rank ortalaman ${-rankDelta} düşük.`,
        );
      }
      const bestRole = rolePairs.find(
        (pair) =>
          pair.matches >= PAIR_MIN_MATCHES &&
          pair.winRate >= 0.6 &&
          pair.selfKey &&
          pair.partnerKey,
      );
      if (bestRole) {
        strengths.push(
          `En verimli düzen: sen ${roleLabel(bestRole.selfKey)}, ${entry.name} ${roleLabel(bestRole.partnerKey)} (${bestRole.wins}/${bestRole.matches}).`,
        );
      }
      const worstRole = [...rolePairs]
        .filter(
          (pair) =>
            pair.matches >= PAIR_MIN_MATCHES &&
            pair.winRate <= 0.34 &&
            pair.selfKey &&
            pair.partnerKey,
        )
        .sort((a, b) => a.winRate - b.winRate || b.matches - a.matches)[0];
      if (worstRole) {
        risks.push(
          `Sen ${roleLabel(worstRole.selfKey)}, ${entry.name} ${roleLabel(worstRole.partnerKey)} iken ${worstRole.matches} maçta ${worstRole.wins} galibiyet.`,
        );
      }
      const bestHeroes = heroPairs.find(
        (pair) =>
          pair.matches >= PAIR_MIN_MATCHES &&
          pair.winRate >= 0.6 &&
          pair.selfKey &&
          pair.partnerKey,
      );
      if (bestHeroes) {
        strengths.push(
          `${heroName(bestHeroes.selfKey)} + ${heroName(bestHeroes.partnerKey)} ikilisi ${bestHeroes.wins}/${bestHeroes.matches}.`,
        );
      }
    }

    return {
      id: entry.id,
      name: entry.name,
      avatar: entry.avatar,
      matches: count,
      wins,
      winRate,
      winDelta,
      rankWith: rankWith === null ? null : Math.round(rankWith),
      rankDelta,
      score,
      rolePairs: rolePairs.slice(0, 3),
      heroPairs: heroPairs.slice(0, 3),
      strengths,
      risks,
    };
  });

  rows.sort(
    (a, b) =>
      Number(b.score !== null) - Number(a.score !== null) ||
      (b.score || 0) - (a.score || 0) ||
      b.matches - a.matches ||
      a.name.localeCompare(b.name),
  );

  return {
    known: known.length,
    overall: {
      matches: known.length,
      wins: overallWins,
      winRate: round2(overallRate),
    },
    partners: rows,
  };
}

/**
 * Rol / hero ikilileri, en cok oynanandan aza.
 * @param {Array<{ match: Record<string, any>, member: Record<string, any> }>} rows
 * @param {(row: { match: Record<string, any>, member: Record<string, any> }) => [string, string]} keyOf
 * @returns {SynergyPair[]}
 */
function pairsOf(rows, keyOf) {
  /** @type {Map<string, SynergyPair>} */
  const pairs = new Map();
  for (const row of rows) {
    const [selfKey, partnerKey] = keyOf(row);
    if (!selfKey && !partnerKey) {
      continue;
    }
    const key = selfKey + "|" + partnerKey;
    const entry = pairs.get(key) || {
      selfKey,
      partnerKey,
      matches: 0,
      wins: 0,
      winRate: 0,
    };
    entry.matches += 1;
    entry.wins += row.match.result === "win" ? 1 : 0;
    pairs.set(key, entry);
  }
  return [...pairs.values()]
    .map((row) => ({ ...row, winRate: round2(row.wins / row.matches) }))
    .sort(
      (a, b) =>
        b.matches - a.matches ||
        b.winRate - a.winRate ||
        (a.selfKey + a.partnerKey).localeCompare(b.selfKey + b.partnerKey),
    );
}

/**
 * 0-100 sinerji puani: 0.5'e cekilmis kazanma orani + Rank farki.
 * @param {number} wins
 * @param {number} matches
 * @param {number|null} rankDelta
 */
function scoreOf(wins, matches, rankDelta) {
  const shrunk = (wins + PRIOR_MATCHES * 0.5) / (matches + PRIOR_MATCHES);
  const rankPart = rankDelta === null ? 0 : clamp(rankDelta / 20, -15, 15);
  return Math.round(clamp(50 + (shrunk - 0.5) * 100 + rankPart, 0, 100));
}

/** @param {Array<number|null>} values */
function average(values) {
  const known = values.filter((value) => Number.isFinite(value));
  return known.length
    ? known.reduce((total, value) => total + value, 0) / known.length
    : null;
}

/** @param {number} value */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/** @param {number} value */
function pct(value) {
  return Math.round(value * 100);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
