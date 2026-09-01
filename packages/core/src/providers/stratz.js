/**
 * Stratz veri kaynagi (OpenDota gunluk limitine takilinca devreye girer).
 *
 * OpenDota'dan iki farki var:
 *   - Tek bir GraphQL ucu vardir; profil + maclar tek istekte gelir.
 *   - API anahtari ZORUNLUDUR (ucretsiz: https://stratz.com/api).
 *     Anahtar yoksa istemci `isConfigured: false` doner ve zincir onu atlar.
 *
 * Ayrica Stratz maclarda dogrudan `position` (POSITION_1..POSITION_5) verir;
 * bu, OpenDota'nin `lane_role` + `is_roaming` tahmininden daha guvenilirdir.
 *
 * Sozlesme OpenDota istemcisiyle aynidir (bkz. providers/opendota.js), boylece
 * provider-chain ikisini ayirt etmeden kullanabilir.
 */

import bundledHeroIds from "../data/hero-ids.js";
import { buildStatsFromMatches } from "./match-stats.js";
import {
  codeFromStatus,
  NOT_CONFIGURED,
  providerError,
  RATE_LIMIT,
  UNAVAILABLE,
} from "./provider-errors.js";

const API_URL = "https://api.stratz.com/graphql";
export const PROVIDER_NAME = "stratz";

/** Stratz, kendi API'sini kullanan istemcilerden bu User-Agent'i bekler. */
const REQUIRED_USER_AGENT = "STRATZ_API";

const HERO_BY_ID = new Map(
  Object.entries(bundledHeroIds).map(([id, name]) => [
    Number(id),
    String(name),
  ]),
);

/** Stratz pozisyon enum'u -> projedeki RoleKey. */
const POSITION_TO_ROLE_KEY = {
  POSITION_1: "pos1",
  POSITION_2: "pos2",
  POSITION_3: "pos3",
  POSITION_4: "pos4",
  POSITION_5: "pos5",
};

const PLAYER_PROFILE_QUERY = `
  query DotaStatProfile($id: Long!) {
    player(steamAccountId: $id) {
      steamAccountId
      steamAccount {
        name
        avatar
        id
        isAnonymous
        seasonRank
        seasonLeaderboardRank
      }
    }
  }
`;

const PLAYER_MATCHES_QUERY = `
  query DotaStatMatches($id: Long!, $take: Int!) {
    player(steamAccountId: $id) {
      matches(request: { take: $take }) {
        id
        didRadiantWin
        startDateTime
        durationSeconds
        players(steamAccountId: $id) {
          heroId
          isRadiant
          isVictory
          kills
          deaths
          assists
          goldPerMinute
          experiencePerMinute
          heroDamage
          heroHealing
          towerDamage
          numLastHits
          numDenies
          position
        }
      }
    }
  }
`;

const HERO_PERFORMANCE_QUERY = `
  query DotaStatHeroes($id: Long!) {
    player(steamAccountId: $id) {
      heroesPerformance(request: { take: 250 }) {
        heroId
        matchCount
        winCount
        kDA
      }
    }
  }
`;

/**
 * @param {{ apiKey?: string, timeoutMs?: number }} [options]
 */
export function createStratzClient(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const timeoutMs = Number(options.timeoutMs) || 8000;

  /**
   * @param {string} query
   * @param {Record<string, unknown>} variables
   * @returns {Promise<Record<string, any>>}
   */
  async function graphql(query, variables) {
    if (!apiKey) {
      throw providerError("stratz-anahtar-yok", NOT_CONFIGURED, PROVIDER_NAME);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: "Bearer " + apiKey,
          "user-agent": REQUIRED_USER_AGENT,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw providerError(
          `stratz-${response.status}`,
          codeFromStatus(response.status),
          PROVIDER_NAME,
        );
      }

      const payload = await response.json();
      const firstError = Array.isArray(payload?.errors)
        ? payload.errors[0]
        : null;
      if (firstError) {
        const text = String(firstError.message || "stratz-hatasi");
        throw providerError(
          `stratz-${text}`,
          /limit|quota|exceeded|throttl/i.test(text) ? RATE_LIMIT : UNAVAILABLE,
          PROVIDER_NAME,
        );
      }

      return payload?.data || {};
    } catch (error) {
      if (!(/** @type {any} */ (error)?.code)) {
        throw providerError(
          String(/** @type {any} */ (error)?.message || "stratz-hatasi"),
          UNAVAILABLE,
          PROVIDER_NAME,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stratz mac satirini ortak `PlayerMatch` seklinde donusturur.
   * @param {Record<string, any>} match
   * @param {string} playerId
   * @returns {import("../players/player-types.js").PlayerMatch|null}
   */
  function toPlayerMatch(match, playerId) {
    const row = Array.isArray(match?.players) ? match.players[0] : null;
    if (!row) {
      return null;
    }

    const heroId = Number(row.heroId || 0);
    const startSeconds = Number(match?.startDateTime || 0);

    return {
      matchId: String(match?.id || ""),
      playerId,
      startedAt: startSeconds
        ? new Date(startSeconds * 1000).toISOString()
        : new Date().toISOString(),
      durationSeconds: Number(match?.durationSeconds || 0),
      hero: HERO_BY_ID.get(heroId) || (heroId ? `hero_${heroId}` : ""),
      role: POSITION_TO_ROLE_KEY[String(row.position || "")] || "",
      result: row.isVictory ? "win" : "loss",
      kills: Number(row.kills || 0),
      deaths: Number(row.deaths || 0),
      assists: Number(row.assists || 0),
      gpm: Number(row.goldPerMinute || 0),
      xpm: Number(row.experiencePerMinute || 0),
      heroDamage: Number(row.heroDamage || 0),
      heroHealing: Number(row.heroHealing || 0),
      towerDamage: Number(row.towerDamage || 0),
      lastHits: Number(row.numLastHits || 0),
      denies: Number(row.numDenies || 0),
      // Bu sorguda ward alanlari istenmiyor; 0 yazmak "hic ward dikmedi"
      // anlamina gelip support puanini dusururdu. Bkz. opendota.js'teki
      // ayni gerekce.
      obsPlaced: null,
      senPlaced: null,
      campsStacked: null,
      teamKills: 0,
      teamDeaths: 0,
      // Stratz mac ortalamasini bu sorguda istemiyoruz: yedek kaynagin
      // sorgusuna dogrulanmamis bir alan eklemek, alan yoksa TUM sorguyu
      // GraphQL hatasina dusurur. Motor null gorunce ortalamayi oyuncunun
      // kendi rankindan tahmin eder.
      averageRankTier: null,
      laneResult: "",
      provider: PROVIDER_NAME,
    };
  }

  return {
    name: PROVIDER_NAME,
    label: "Stratz",
    isConfigured: Boolean(apiKey),

    /**
     * @param {string} playerId 32-bit account id
     */
    async getPlayerProfile(playerId) {
      const data = await graphql(PLAYER_PROFILE_QUERY, {
        id: Number(playerId),
      });
      const player = data?.player;
      const account = player?.steamAccount;
      if (!player || !account) {
        return null;
      }

      const rankTier = Number(account.seasonRank);
      const leaderboardRank = Number(account.seasonLeaderboardRank);

      return {
        playerId: String(playerId),
        name: String(account.name || ""),
        avatar: String(account.avatar || ""),
        steamId: String(account.id || ""),
        // Stratz'in karsiligi: "Expose Public Match Data" kapali oyuncular
        // anonim gorunur ve mac listeleri bos doner (toplam mac sayisi yine
        // gorunebilir). OpenDota'daki fh_unavailable ile ayni durum.
        historyUnavailable: Boolean(account.isAnonymous),
        rankTier: Number.isFinite(rankTier) && rankTier > 0 ? rankTier : null,
        leaderboardRank:
          Number.isFinite(leaderboardRank) && leaderboardRank > 0
            ? leaderboardRank
            : null,
        provider: PROVIDER_NAME,
        fetchedAt: new Date().toISOString(),
      };
    },

    /**
     * @param {string} playerId
     * @param {{ limit?: number }} [matchOptions]
     */
    async getRecentMatches(playerId, matchOptions = {}) {
      const take = Math.min(100, Math.max(1, Number(matchOptions.limit) || 20));
      const data = await graphql(PLAYER_MATCHES_QUERY, {
        id: Number(playerId),
        take,
      });
      const rows = Array.isArray(data?.player?.matches)
        ? data.player.matches
        : [];
      return rows
        .map((row) => toPlayerMatch(row, String(playerId)))
        .filter(
          /** @returns {row is import("../players/player-types.js").PlayerMatch} */
          (row) => Boolean(row && row.matchId),
        );
    },

    /**
     * @param {string} playerId
     * @param {{ limit?: number }} [statsOptions]
     */
    async getPlayerStats(playerId, statsOptions = {}) {
      const matches = await this.getRecentMatches(playerId, {
        limit: Number(statsOptions.limit) || 100,
      });
      return buildStatsFromMatches(String(playerId), matches, PROVIDER_NAME);
    },

    /**
     * TUM zamanlarin hero istatistigi.
     * @param {string} playerId
     * @returns {Promise<import("../players/player-types.js").HeroPerformanceRow[]>}
     */
    async getHeroPerformance(playerId) {
      const data = await graphql(HERO_PERFORMANCE_QUERY, {
        id: Number(playerId),
      });
      const rows = Array.isArray(data?.player?.heroesPerformance)
        ? data.player.heroesPerformance
        : [];
      return rows
        .map((row) => {
          const heroId = Number(row?.heroId || 0);
          const matches = Number(row?.matchCount || 0);
          const wins = Number(row?.winCount || 0);
          return {
            hero: HERO_BY_ID.get(heroId) || (heroId ? `hero_${heroId}` : ""),
            matches,
            wins,
            winRate: matches ? Number((wins / matches).toFixed(4)) : 0,
            avgKda: Number(row?.kDA || 0),
            provider: PROVIDER_NAME,
          };
        })
        .filter((row) => row.hero && row.matches > 0)
        .sort((a, b) => b.matches - a.matches);
    },
  };
}
