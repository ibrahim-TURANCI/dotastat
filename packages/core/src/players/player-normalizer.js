/**
 * Player kayitlarinin normalizasyonu.
 *
 * Kismi (partial) girdiden tam bir Player nesnesi uretir. Boylece hem seed
 * verisi hem de "sadece name + player_id" ile eklenen yeni oyuncu ayni sekleri
 * paylasir ve UI tarafinda eksik alan kontrolu gerekmez.
 */

import {
  normalizeRoleKey,
  resolveRankTier,
  ROLE_KEYS,
} from "./player-types.js";

const PLAYER_ID_PATTERN = /^\d{1,12}$/;
const STEAM_ID64_PATTERN = /^\d{17}$/;
const STEAM_ACCOUNT_ID_OFFSET = 76561197960265728n;

/** Bos bir performans profili (yeni eklenen oyuncular icin). */
const EMPTY_PERFORMANCE_PROFILE = {
  strongHeroPerformance: { min: 0, max: 0 },
  gameKnowledgeLevel: { min: 0, max: 0 },
  averageHeroPerformance: { min: 0, max: 0 },
  weakHeroPerformance: { min: 0, max: 0 },
  unplayableHeroCount: { min: 0, max: 0 },
  actualRank: 0,
};

/**
 * Girilen degeri 32-bit Dota account id'ye cevirir.
 * 17 haneli SteamID64 girilirse otomatik donusturur.
 * @param {unknown} value
 * @returns {string} gecerli degilse ""
 */
function toAccountId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (STEAM_ID64_PATTERN.test(raw)) {
    try {
      const accountId = BigInt(raw) - STEAM_ACCOUNT_ID_OFFSET;
      return accountId > 0n ? String(accountId) : "";
    } catch {
      return "";
    }
  }
  return PLAYER_ID_PATTERN.test(raw) ? raw : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} values
 * @returns {string[]}
 */
function toTextArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(values.map((value) => toText(value)).filter(Boolean)),
  );
}

/**
 * Hero adlarini projedeki normalize hero key formatina cevirir.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHeroKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^npc_dota_hero_/, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * @param {unknown} values
 * @returns {string[]}
 */
function toHeroArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(values.map((value) => normalizeHeroKey(value)).filter(Boolean)),
  );
}

/**
 * @param {string} name
 * @param {string} playerId
 * @returns {string}
 */
function buildPlayerSlug(name, playerId) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return slug || `player-${playerId}`;
}

/**
 * @param {unknown} value
 * @param {{ min: number, max: number }} fallback
 * @returns {{ min: number, max: number }}
 */
function normalizeRange(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const min = Number(source.min);
  const max = Number(source.max);
  const safeMin = Number.isFinite(min) && min >= 0 ? min : fallback.min;
  const safeMax = Number.isFinite(max) && max >= 0 ? max : fallback.max;
  return safeMax < safeMin
    ? { min: safeMax, max: safeMin }
    : { min: safeMin, max: safeMax };
}

/**
 * @param {unknown} input
 * @returns {import("./player-types").PerformanceProfile}
 */
function normalizePerformanceProfile(input) {
  const source = input && typeof input === "object" ? input : {};
  const actualRank = Number(source.actualRank);
  return {
    strongHeroPerformance: normalizeRange(
      source.strongHeroPerformance,
      EMPTY_PERFORMANCE_PROFILE.strongHeroPerformance,
    ),
    gameKnowledgeLevel: normalizeRange(
      source.gameKnowledgeLevel,
      EMPTY_PERFORMANCE_PROFILE.gameKnowledgeLevel,
    ),
    averageHeroPerformance: normalizeRange(
      source.averageHeroPerformance,
      EMPTY_PERFORMANCE_PROFILE.averageHeroPerformance,
    ),
    weakHeroPerformance: normalizeRange(
      source.weakHeroPerformance,
      EMPTY_PERFORMANCE_PROFILE.weakHeroPerformance,
    ),
    unplayableHeroCount: normalizeRange(
      source.unplayableHeroCount,
      EMPTY_PERFORMANCE_PROFILE.unplayableHeroCount,
    ),
    actualRank: Number.isFinite(actualRank) && actualRank >= 0 ? actualRank : 0,
  };
}

/**
 * @param {unknown} input
 * @returns {import("./player-types").DotaProfile}
 */
function normalizeDotaProfile(input) {
  const source = input && typeof input === "object" ? input : {};
  const primaryRole = normalizeRoleKey(source.primaryRole);
  const secondaryRoles = Array.isArray(source.secondaryRoles)
    ? Array.from(
        new Set(
          source.secondaryRoles
            .map((role) => normalizeRoleKey(role))
            .filter((role) => role && role !== primaryRole),
        ),
      )
    : [];

  return {
    primaryRole,
    secondaryRoles: secondaryRoles.filter((role) => ROLE_KEYS.includes(role)),
    signatureHeroes: toHeroArray(source.signatureHeroes),
    preferredHeroes: toHeroArray(source.preferredHeroes),
    weakHeroes: toHeroArray(source.weakHeroes),
    experimentalHeroes: toHeroArray(source.experimentalHeroes),
  };
}

/**
 * @param {unknown} input
 * @returns {import("./player-types").PlayerCharacter}
 */
function normalizeCharacter(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    generalPlaystyle: toText(source.generalPlaystyle),
    strengths: toTextArray(source.strengths),
    weaknesses: toTextArray(source.weaknesses),
    developmentAreas: toTextArray(source.developmentAreas),
    laneBehavior: toText(source.laneBehavior),
    teamfightBehavior: toText(source.teamfightBehavior),
    mapTempoVisionBehavior: toText(source.mapTempoVisionBehavior),
    bestTeamUsage: toText(source.bestTeamUsage),
    synergyNotes: toTextArray(source.synergyNotes),
    funnyAdvice: toText(source.funnyAdvice),
  };
}

/**
 * Kayitli rank bilgisini dogrular; bozuksa null doner.
 * @param {unknown} input
 * @returns {import("./player-types").PlayerRank|null}
 */
function normalizeRank(input) {
  const source = input && typeof input === "object" ? input : null;
  if (!source) {
    return null;
  }
  return resolveRankTier(source.tier, {
    leaderboardRank: source.leaderboardRank,
    provider: source.provider,
    fetchedAt: source.fetchedAt,
  });
}

/**
 * Kismi girdiden tam Player uretir.
 * @param {Record<string, unknown>} input
 * @param {{ now?: string, source?: string }} [options]
 * @returns {import("./player-types").Player|null} player_id gecersizse null
 */
function normalizePlayer(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const playerId = toAccountId(source.player_id ?? source.playerId);
  const name = toText(source.name);
  if (!playerId || !name) {
    return null;
  }

  const now = options.now || new Date().toISOString();

  return {
    id: toText(source.id) || buildPlayerSlug(name, playerId),
    name,
    player_id: playerId,
    avatar: toText(source.avatar),
    active: source.active === undefined ? true : Boolean(source.active),
    createdAt: toText(source.createdAt) || now,
    updatedAt: toText(source.updatedAt) || now,
    dotaProfile: normalizeDotaProfile(source.dotaProfile),
    character: normalizeCharacter(source.character),
    performanceProfile: normalizePerformanceProfile(source.performanceProfile),
    rank: normalizeRank(source.rank),
    rankFetchedAt: toText(source.rankFetchedAt),
    source: toText(source.source) || options.source || "manual",
  };
}

/**
 * @param {unknown} input
 * @returns {import("./player-types").PlayerSynergy|null}
 */
function normalizeSynergy(input) {
  const source = input && typeof input === "object" ? input : {};
  const playerId1 = toText(source.playerId1);
  const playerId2 = toText(source.playerId2);
  if (!playerId1 || !playerId2 || playerId1 === playerId2) {
    return null;
  }

  const score = Number(source.synergyScore);
  return {
    id: toText(source.id) || buildSynergyId(playerId1, playerId2),
    playerId1,
    playerId2,
    synergyScore:
      Number.isFinite(score) && score >= 0
        ? Math.min(100, Math.round(score))
        : undefined,
    description: toText(source.description),
    strengths: toTextArray(source.strengths),
    risks: toTextArray(source.risks),
  };
}

/**
 * Sirasiz ikili icin kararli id uretir.
 * @param {string} playerId1
 * @param {string} playerId2
 * @returns {string}
 */
function buildSynergyId(playerId1, playerId2) {
  return [String(playerId1), String(playerId2)].sort().join("__");
}

export {
  EMPTY_PERFORMANCE_PROFILE,
  buildPlayerSlug,
  buildSynergyId,
  normalizeCharacter,
  normalizeDotaProfile,
  normalizeHeroKey,
  normalizePerformanceProfile,
  normalizePlayer,
  normalizeRank,
  normalizeSynergy,
  toAccountId,
};
