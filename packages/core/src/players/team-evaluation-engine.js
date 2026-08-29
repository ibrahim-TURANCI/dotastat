/**
 * TeamEvaluationEngine
 *
 * Bir dizilim (5 oyuncu + rol atamasi) icin:
 *   - rol uyumu
 *   - performans potansiyeli
 *   - oyuncular arasi sinerji
 *   - takim dengesi (core/support agirligi, shot-caller, vision sorumlusu)
 * degerlendirmesi uretir.
 *
 * Ayrica havuzdaki oyunculardan en verimli dizilimi onerir. Oneri algoritmasi
 * oyuncuya ozel dallanma icermez; sadece profil verisi uzerinden calisir, bu
 * yuzden havuza yeni oyuncu eklendiginde otomatik olarak dikkate alinir.
 */

import { ROLE_GROUP, ROLE_KEYS } from "./player-types.js";
import { buildSynergyId } from "./player-normalizer.js";

/** Rol uyumu -> puan (0..1). */
const ROLE_FIT_SCORE = {
  excellent: 1,
  good: 0.75,
  neutral: 0.45,
  poor: 0.15,
};

/** Takim skorunun bilesen agirliklari. */
const TEAM_WEIGHTS = {
  roleFit: 0.4,
  performancePotential: 0.35,
  synergy: 0.25,
};

/** Performans potansiyelini 0..1'e normalize ederken kullanilan tavan. */
const PERFORMANCE_NORMALIZER = 6000;

/** Sinerji verisi olmayan ikili icin notr taban. */
const NEUTRAL_SYNERGY_SCORE = 50;

/** Takim dengesi uyarilari icin esikler. */
const BALANCE_THRESHOLDS = {
  minGameKnowledgeForShotCaller: 3500,
  minVisionRoleCount: 1,
  lowRoleFitScore: 0.45,
};

/**
 * @param {import("./player-types").Player} player
 * @param {import("./player-types").RoleKey} role
 * @returns {import("./player-types").FitLevel}
 */
function resolveRoleFitLevel(player, role) {
  const profile = player?.dotaProfile;
  if (!profile?.primaryRole) {
    return "neutral";
  }
  if (profile.primaryRole === role) return "excellent";
  if (profile.secondaryRoles.includes(role)) return "good";
  return ROLE_GROUP[profile.primaryRole] === ROLE_GROUP[role]
    ? "neutral"
    : "poor";
}

/**
 * Oyuncunun bu roldeki beklenen performans seviyesi.
 * Dogal rolunde strong hero araligi, disinda average/weak araliga yaklasir.
 * @param {import("./player-types").Player} player
 * @param {import("./player-types").RoleKey} role
 * @returns {number}
 */
function expectedPerformanceForRole(player, role) {
  const profile = player?.performanceProfile;
  if (!profile) {
    return 0;
  }

  const strong =
    (Number(profile.strongHeroPerformance.min) +
      Number(profile.strongHeroPerformance.max)) /
    2;
  const average =
    (Number(profile.averageHeroPerformance.min) +
      Number(profile.averageHeroPerformance.max)) /
    2;
  const weak =
    (Number(profile.weakHeroPerformance.min) +
      Number(profile.weakHeroPerformance.max)) /
    2;

  const fit = resolveRoleFitLevel(player, role);
  if (fit === "excellent") return strong || average || weak;
  if (fit === "good") return (strong + average) / 2 || average;
  if (fit === "neutral") return average || weak;
  return weak || average;
}

/**
 * @param {import("./player-types").PlayerSynergy[]} synergies
 * @returns {Map<string, import("./player-types").PlayerSynergy>}
 */
function indexSynergies(synergies) {
  const map = new Map();
  for (const row of Array.isArray(synergies) ? synergies : []) {
    if (row?.playerId1 && row?.playerId2) {
      map.set(buildSynergyId(row.playerId1, row.playerId2), row);
    }
  }
  return map;
}

/**
 * @param {Array<{ player: import("./player-types").Player, role: import("./player-types").RoleKey }>} lineup
 * @param {Map<string, import("./player-types").PlayerSynergy>} synergyIndex
 * @returns {{ average: number, pairs: Array<{ id: string, playerId1: string, playerId2: string, synergyScore: number, description: string, strengths: string[], risks: string[], known: boolean }> }}
 */
function evaluateSynergyPairs(lineup, synergyIndex) {
  const pairs = [];
  let total = 0;
  let count = 0;

  for (let i = 0; i < lineup.length; i += 1) {
    for (let j = i + 1; j < lineup.length; j += 1) {
      const first = lineup[i].player;
      const second = lineup[j].player;
      const id = buildSynergyId(first.id, second.id);
      const known = synergyIndex.get(id) || null;
      const score = Number(known?.synergyScore ?? NEUTRAL_SYNERGY_SCORE);

      total += score;
      count += 1;

      if (known) {
        pairs.push({
          id,
          playerId1: known.playerId1,
          playerId2: known.playerId2,
          synergyScore: score,
          description: known.description,
          strengths: known.strengths,
          risks: known.risks,
          known: true,
        });
      }
    }
  }

  return {
    average: count ? Number((total / count).toFixed(2)) : NEUTRAL_SYNERGY_SCORE,
    pairs: pairs.sort((a, b) => b.synergyScore - a.synergyScore),
  };
}

/**
 * @param {Array<{ player: import("./player-types").Player, role: import("./player-types").RoleKey }>} lineup
 * @returns {string[]}
 */
function buildBalanceNotes(lineup) {
  const notes = [];

  const shotCaller = lineup
    .filter(
      (row) =>
        (Number(row.player.performanceProfile.gameKnowledgeLevel.max) || 0) >=
        BALANCE_THRESHOLDS.minGameKnowledgeForShotCaller,
    )
    .sort(
      (a, b) =>
        Number(b.player.performanceProfile.gameKnowledgeLevel.max) -
        Number(a.player.performanceProfile.gameKnowledgeLevel.max),
    )[0];
  if (!shotCaller) {
    notes.push("Takimda belirgin bir shot-caller yok; oyun plani dagilabilir.");
  } else {
    notes.push(
      `Shot-caller adayi: ${shotCaller.player.name} (oyun bilgisi en yuksek).`,
    );
  }

  const visionPlayers = lineup.filter(
    (row) =>
      ROLE_GROUP[row.role] === "support" &&
      row.player.character.mapTempoVisionBehavior,
  );
  if (visionPlayers.length < BALANCE_THRESHOLDS.minVisionRoleCount) {
    notes.push("Vision ve detection sorumlulugu net degil.");
  }

  const misfits = lineup.filter(
    (row) =>
      ROLE_FIT_SCORE[resolveRoleFitLevel(row.player, row.role)] <=
      BALANCE_THRESHOLDS.lowRoleFitScore,
  );
  for (const row of misfits) {
    notes.push(
      `${row.player.name} ${row.role.toUpperCase()} rolunde dogal degil; performans dususu beklenmeli.`,
    );
  }

  const coreCount = lineup.filter(
    (row) => ROLE_GROUP[row.role] === "core",
  ).length;
  if (coreCount !== 3) {
    notes.push(`Core/support dagilimi standart disi (${coreCount} core).`);
  }

  return notes;
}

/**
 * Bir dizilimi degerlendirir.
 *
 * @param {Object} input
 * @param {Array<{ playerId: string, role: import("./player-types").RoleKey }>} input.lineup
 * @param {import("./player-types").Player[]} input.players
 * @param {import("./player-types").PlayerSynergy[]} [input.synergies]
 * @returns {{ ok: boolean, error?: string, totalScore: number, roleFitScore: number, performanceScore: number, synergyScore: number, slots: Array<Record<string, unknown>>, synergyPairs: Array<Record<string, unknown>>, notes: string[] }}
 */
function evaluateTeam(input) {
  const playersById = new Map(
    (Array.isArray(input?.players) ? input.players : []).map((player) => [
      player.id,
      player,
    ]),
  );

  /** @type {Array<{ player: import("./player-types").Player, role: import("./player-types").RoleKey }>} */
  const lineup = [];
  const usedRoles = new Set();

  for (const entry of Array.isArray(input?.lineup) ? input.lineup : []) {
    const player = playersById.get(String(entry?.playerId || ""));
    const role = /** @type {import("./player-types").RoleKey} */ (
      String(entry?.role || "")
    );
    if (!player || !ROLE_KEYS.includes(role)) {
      continue;
    }
    if (usedRoles.has(role)) {
      return {
        ok: false,
        error: `rol-tekrar-ediyor: ${role}`,
        totalScore: 0,
        roleFitScore: 0,
        performanceScore: 0,
        synergyScore: 0,
        slots: [],
        synergyPairs: [],
        notes: [],
      };
    }
    usedRoles.add(role);
    lineup.push({ player, role });
  }

  if (!lineup.length) {
    return {
      ok: false,
      error: "gecerli-oyuncu-yok",
      totalScore: 0,
      roleFitScore: 0,
      performanceScore: 0,
      synergyScore: 0,
      slots: [],
      synergyPairs: [],
      notes: [],
    };
  }

  const slots = lineup.map((row) => {
    const fit = resolveRoleFitLevel(row.player, row.role);
    const expected = expectedPerformanceForRole(row.player, row.role);
    return {
      role: row.role,
      playerId: row.player.id,
      name: row.player.name,
      player_id: row.player.player_id,
      roleFit: fit,
      roleFitScore: ROLE_FIT_SCORE[fit],
      expectedPerformance: Math.round(expected),
      naturalRole: row.player.dotaProfile.primaryRole,
      bestTeamUsage: row.player.character.bestTeamUsage,
    };
  });

  const roleFitScore =
    slots.reduce((total, slot) => total + Number(slot.roleFitScore), 0) /
    slots.length;
  const performanceScore =
    slots.reduce(
      (total, slot) =>
        total +
        Math.min(1, Number(slot.expectedPerformance) / PERFORMANCE_NORMALIZER),
      0,
    ) / slots.length;

  const synergy = evaluateSynergyPairs(
    lineup,
    indexSynergies(input?.synergies),
  );
  const synergyNormalized = synergy.average / 100;

  const totalScore =
    TEAM_WEIGHTS.roleFit * roleFitScore +
    TEAM_WEIGHTS.performancePotential * performanceScore +
    TEAM_WEIGHTS.synergy * synergyNormalized;

  return {
    ok: true,
    totalScore: Number((totalScore * 100).toFixed(1)),
    roleFitScore: Number((roleFitScore * 100).toFixed(1)),
    performanceScore: Number((performanceScore * 100).toFixed(1)),
    synergyScore: synergy.average,
    slots: slots.sort(
      (a, b) =>
        ROLE_KEYS.indexOf(/** @type {never} */ (a.role)) -
        ROLE_KEYS.indexOf(/** @type {never} */ (b.role)),
    ),
    synergyPairs: synergy.pairs,
    notes: buildBalanceNotes(lineup),
  };
}

/**
 * Havuzdan en verimli 5 kisilik dizilimi onerir.
 *
 * Once acgozlu (greedy) atama yapilir, ardindan yerel arama ile (atanmis
 * ikililerin rol takasi + yedekle degistirme) skor iyilestirilir. Havuz
 * buyudukce calisma suresi lineer artar, kombinatoryal patlama olmaz.
 *
 * @param {Object} input
 * @param {import("./player-types").Player[]} input.players
 * @param {import("./player-types").PlayerSynergy[]} [input.synergies]
 * @returns {ReturnType<typeof evaluateTeam> & { lineup: Array<{ playerId: string, role: import("./player-types").RoleKey }> }}
 */
function suggestLineup(input) {
  const pool = (Array.isArray(input?.players) ? input.players : []).filter(
    (player) => player?.active !== false,
  );
  const synergies = input?.synergies || [];

  const emptyResult = {
    ...evaluateTeam({ lineup: [], players: pool, synergies }),
    lineup: [],
  };

  if (pool.length < ROLE_KEYS.length) {
    return { ...emptyResult, error: "yeterli-oyuncu-yok" };
  }

  /**
   * @param {Array<{ playerId: string, role: import("./player-types").RoleKey }>} lineup
   * @returns {number}
   */
  function scoreOf(lineup) {
    const result = evaluateTeam({ lineup, players: pool, synergies });
    return result.ok ? result.totalScore : -1;
  }

  // 1) Greedy: her rol icin en yuksek (rol uyumu * beklenen performans) oyuncu.
  const assigned = new Map();
  const takenPlayers = new Set();

  const candidates = [];
  for (const role of ROLE_KEYS) {
    for (const player of pool) {
      const fit = resolveRoleFitLevel(player, role);
      candidates.push({
        role,
        player,
        score:
          ROLE_FIT_SCORE[fit] *
          Math.min(
            1,
            expectedPerformanceForRole(player, role) / PERFORMANCE_NORMALIZER,
          ),
      });
    }
  }
  candidates.sort(
    (a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id),
  );

  for (const candidate of candidates) {
    if (assigned.has(candidate.role) || takenPlayers.has(candidate.player.id)) {
      continue;
    }
    assigned.set(candidate.role, candidate.player.id);
    takenPlayers.add(candidate.player.id);
    if (assigned.size === ROLE_KEYS.length) {
      break;
    }
  }

  /** @type {Array<{ playerId: string, role: import("./player-types").RoleKey }>} */
  let best = ROLE_KEYS.map((role) => ({
    role,
    playerId: String(assigned.get(role) || ""),
  })).filter((row) => row.playerId);

  if (best.length < ROLE_KEYS.length) {
    return { ...emptyResult, error: "atama-tamamlanamadi" };
  }

  let bestScore = scoreOf(best);

  // 2) Yerel arama: rol takasi ve yedek oyuncu degisimi.
  let improved = true;
  let guard = 0;
  while (improved && guard < 50) {
    improved = false;
    guard += 1;

    for (let i = 0; i < best.length; i += 1) {
      for (let j = i + 1; j < best.length; j += 1) {
        const candidateLineup = best.map((row) => ({ ...row }));
        const temp = candidateLineup[i].playerId;
        candidateLineup[i].playerId = candidateLineup[j].playerId;
        candidateLineup[j].playerId = temp;
        const score = scoreOf(candidateLineup);
        if (score > bestScore) {
          best = candidateLineup;
          bestScore = score;
          improved = true;
        }
      }
    }

    const inLineup = new Set(best.map((row) => row.playerId));
    for (const player of pool) {
      if (inLineup.has(player.id)) {
        continue;
      }
      for (let i = 0; i < best.length; i += 1) {
        const candidateLineup = best.map((row) => ({ ...row }));
        candidateLineup[i].playerId = player.id;
        const score = scoreOf(candidateLineup);
        if (score > bestScore) {
          best = candidateLineup;
          bestScore = score;
          improved = true;
          inLineup.clear();
          for (const row of best) {
            inLineup.add(row.playerId);
          }
          break;
        }
      }
    }
  }

  return {
    ...evaluateTeam({ lineup: best, players: pool, synergies }),
    lineup: best,
  };
}

export {
  PERFORMANCE_NORMALIZER,
  ROLE_FIT_SCORE,
  TEAM_WEIGHTS,
  evaluateTeam,
  expectedPerformanceForRole,
  resolveRoleFitLevel,
  suggestLineup,
};
