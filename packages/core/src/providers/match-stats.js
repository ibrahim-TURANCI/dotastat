/**
 * Ham mac satirlarindan rol/hero istatistigi turetir.
 *
 * Provider'dan bagimsizdir: elinde `PlayerMatch[]` olan her katman (Netlify
 * Function, Electron sunucusu, tarayici) ayni `PlayerStats` seklini uretir.
 */

/**
 * @param {string} playerId
 * @param {import("../players/player-types.js").PlayerMatch[]} matches
 * @param {string} providerName
 * @returns {import("../players/player-types.js").PlayerStats}
 */
export function buildStatsFromMatches(playerId, matches, providerName) {
  const rows = Array.isArray(matches) ? matches : [];
  /** @type {Record<string, { matches: number, wins: number, winRate: number }>} */
  const roles = {};
  /** @type {Map<string, { hero: string, matches: number, wins: number, kdaSum: number }>} */
  const heroes = new Map();

  let wins = 0;

  for (const row of rows) {
    const won = row?.result === "win";
    if (won) {
      wins += 1;
    }

    const role = String(row?.role || "");
    if (role) {
      const bucket = roles[role] || { matches: 0, wins: 0, winRate: 0 };
      bucket.matches += 1;
      bucket.wins += won ? 1 : 0;
      bucket.winRate = Number((bucket.wins / bucket.matches).toFixed(4));
      roles[role] = bucket;
    }

    const hero = String(row?.hero || "");
    if (!hero) {
      continue;
    }

    const heroBucket = heroes.get(hero) || {
      hero,
      matches: 0,
      wins: 0,
      kdaSum: 0,
    };
    heroBucket.matches += 1;
    heroBucket.wins += won ? 1 : 0;
    heroBucket.kdaSum +=
      (Number(row?.kills || 0) + Number(row?.assists || 0)) /
      Math.max(1, Number(row?.deaths || 0));
    heroes.set(hero, heroBucket);
  }

  return {
    playerId,
    matches: rows.length,
    wins,
    winRate: rows.length ? Number((wins / rows.length).toFixed(4)) : 0,
    roles,
    heroes: Array.from(heroes.values())
      .map((row) => ({
        hero: row.hero,
        matches: row.matches,
        wins: row.wins,
        winRate: Number((row.wins / row.matches).toFixed(4)),
        avgKda: Number((row.kdaSum / row.matches).toFixed(2)),
      }))
      .sort((a, b) => b.matches - a.matches || b.winRate - a.winRate),
    provider: providerName,
    fetchedAt: new Date().toISOString(),
  };
}
