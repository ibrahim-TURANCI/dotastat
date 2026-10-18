/**
 * Stratz veri kaynagi.
 *
 * Mac listesi, mac detayi ve hero istatistiginde BIRINCIL kaynaktir (bkz.
 * player-data-service -> PROVIDER_ORDER); OpenDota yedektir. Profil (rank
 * madalyasi) OpenDota'dan gelir: Stratz'in sezon rank'i geride kalabiliyor.
 *
 * NEDEN BIRINCIL: ayni mac icin OpenDota'dan daha fazlasini verir —
 *   - gercek `position` (POSITION_1..5). OpenDota'nin `lane_role` alani
 *     KORIDOR soyler; safe lane'deki Pos 5'i "pos1" yapar.
 *   - parse edilmis macta ward, stack, takim kill'i ve koridor sonucu.
 *     OpenDota bunlari mac listesinde hic vermez, detayda da cogu mac
 *     parse edilmemis oluyor.
 *   - yeni biten maci dakikalar icinde gorur (OpenDota'da saatler surebiliyor).
 *
 * API anahtari ZORUNLUDUR (ucretsiz: https://stratz.com/api). Anahtar yoksa
 * istemci `isConfigured: false` doner ve zincir onu atlar; o zaman her sey
 * OpenDota'dan gelir.
 *
 * Sozlesme OpenDota istemcisiyle aynidir (bkz. providers/opendota.js), boylece
 * provider-chain ikisini ayirt etmeden kullanabilir.
 */

import bundledHeroIds from "../data/hero-ids.js";
import bundledItemIds from "../data/item-ids.js";
import { averageTierOf } from "./opendota.js";
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

const ITEM_BY_ID = new Map(
  Object.entries(bundledItemIds).map(([id, row]) => [
    Number(id),
    String(row?.key || ""),
  ]),
);

/** Stratz `WardType` enum sirasi: 0 = OBSERVER, 1 = SENTRY. */
const WARD_OBSERVER = 0;
const WARD_SENTRY = 1;

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
        averageRank
        rank
        radiantKills
        direKills
        bottomLaneOutcome
        midLaneOutcome
        topLaneOutcome
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
          lane
          stats {
            campStack
            wards {
              type
            }
          }
        }
      }
    }
  }
`;

const HERO_PERFORMANCE_QUERY = `
  query DotaStatHeroes($id: Long!) {
    player(steamAccountId: $id) {
      # request.take BAKILAN MAC sayisidir: verilmezse yalnizca son ~25 mac
      # sayiliyordu (olculdu: 7484 macli oyuncuda 28 mac, 10 hero). Buyuk
      # deger tum zamanlari verir; OpenDota /heroes ile tutarli.
      heroesPerformance(request: { take: 100000 }, take: 250) {
        heroId
        matchCount
        winCount
        kDA
      }
    }
  }
`;

const MATCH_DETAIL_QUERY = `
  query DotaStatMatch($id: Long!) {
    match(id: $id) {
      id
      didRadiantWin
      startDateTime
      durationSeconds
      averageRank
      rank
      radiantKills
      direKills
      bottomLaneOutcome
      midLaneOutcome
      topLaneOutcome
      players {
        steamAccountId
        steamAccount {
          name
          seasonRank
          isAnonymous
        }
        playerSlot
        heroId
        isRadiant
        isVictory
        kills
        deaths
        assists
        goldPerMinute
        experiencePerMinute
        networth
        level
        heroDamage
        heroHealing
        towerDamage
        numLastHits
        numDenies
        position
        lane
        item0Id
        item1Id
        item2Id
        item3Id
        item4Id
        item5Id
        neutral0Id
        stats {
          campStack
          wards {
            type
          }
        }
      }
    }
  }
`;

/**
 * Parse edilmis mac mi? Parse edilmemis macta dakika dakika kill dizileri,
 * pozisyon ve ward olaylari bos gelir; o alanlar "bilinmiyor" sayilmali.
 * @param {Record<string, any>} match
 */
function isParsedMatch(match) {
  return (
    (Array.isArray(match?.radiantKills) && match.radiantKills.length > 0) ||
    (Array.isArray(match?.direKills) && match.direKills.length > 0)
  );
}

/** @param {unknown} values */
function sumOf(values) {
  return (Array.isArray(values) ? values : []).reduce(
    (total, value) => total + (Number(value) || 0),
    0,
  );
}

/**
 * Oyuncunun koridor sonucu ("won" | "draw" | "lost" | "").
 *
 * Stratz sonucu koridor bazinda verir (alt / orta / ust). Radiant'in safe
 * lane'i alt, Dire'inki ust koridordur; offlane tersidir.
 *
 * @param {Record<string, any>} match
 * @param {Record<string, any>} row
 */
function laneResultOf(match, row) {
  const radiant = Boolean(row?.isRadiant);
  const lane = String(row?.lane || "");
  const outcome =
    lane === "MID_LANE"
      ? match?.midLaneOutcome
      : lane === "SAFE_LANE"
        ? radiant
          ? match?.bottomLaneOutcome
          : match?.topLaneOutcome
        : lane === "OFF_LANE"
          ? radiant
            ? match?.topLaneOutcome
            : match?.bottomLaneOutcome
          : null;
  const value = String(outcome || "");
  if (!value) {
    return "";
  }
  if (value === "TIE") {
    return "draw";
  }
  const radiantWon = value.startsWith("RADIANT");
  return radiantWon === radiant ? "won" : "lost";
}

/**
 * Ward ve stack sayilari. Parse edilmemis macta null: "sifir ward" ile
 * "bilmiyoruz" ayni sey degil (bkz. opendota.js'teki ayni gerekce).
 * @param {Record<string, any>} match
 * @param {Record<string, any>} row
 */
function visionOf(match, row) {
  if (!isParsedMatch(match) || !row?.stats) {
    return { obsPlaced: null, senPlaced: null, campsStacked: null };
  }
  const wards = Array.isArray(row.stats.wards) ? row.stats.wards : [];
  const stacks = Array.isArray(row.stats.campStack) ? row.stats.campStack : [];
  return {
    obsPlaced: wards.filter((ward) => Number(ward?.type) === WARD_OBSERVER)
      .length,
    senPlaced: wards.filter((ward) => Number(ward?.type) === WARD_SENTRY)
      .length,
    // Dizi kumulatif (dakika basina o ana kadarki toplam).
    campsStacked: stacks.length ? Number(stacks[stacks.length - 1]) || 0 : null,
  };
}

/**
 * Macin rank kademesi (ornek 54 = Legend 4). `averageRank` cogu macta bos
 * geliyor; `rank` macin kademesidir.
 * @param {Record<string, any>} match
 */
function matchRankTierOf(match) {
  const tier = Number(match?.averageRank || match?.rank || 0);
  return Number.isFinite(tier) && tier > 0 ? tier : null;
}

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
    const parsed = isParsedMatch(match);
    const radiantKills = sumOf(match?.radiantKills);
    const direKills = sumOf(match?.direKills);

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
      side:
        typeof row.isRadiant === "boolean"
          ? row.isRadiant
            ? "radiant"
            : "dire"
          : "",
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
      ...visionOf(match, row),
      // Takim skoru yalnizca parse edilmis macta bilinir; 0 = bilinmiyor.
      teamKills: parsed ? (row.isRadiant ? radiantKills : direKills) : 0,
      teamDeaths: parsed ? (row.isRadiant ? direKills : radiantKills) : 0,
      averageRankTier: matchRankTierOf(match),
      laneResult: laneResultOf(match, row),
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
     * Tek macin TAM kadrosu. OpenDota'daki ayni adli metotla ayni sekli
     * doner (bkz. opendota.js -> getMatchDetail).
     *
     * GIZLILIK: Stratz, mac verisini gizlemis (`isAnonymous`) oyuncularin da
     * hesap kimligini ve adini donduruyor. OpenDota bunlari gizliyor; ayni
     * davranis korunur — hesap ve ad bos birakilir.
     *
     * @param {string} matchId
     * @returns {Promise<Record<string, any>|null>} Oyuncu listesi yoksa null
     */
    async getMatchDetail(matchId) {
      const data = await graphql(MATCH_DETAIL_QUERY, { id: Number(matchId) });
      const match = data?.match;
      const players = Array.isArray(match?.players) ? match.players : [];
      if (!match || !players.length) {
        return null;
      }

      // Parse edilmemis macta dakika dizileri bos: skor oyuncularin kill
      // toplamindan hesaplanir (on oyuncunun hepsi detayda var).
      const parsed = isParsedMatch(match);
      const killsOf = (radiant) =>
        players
          .filter((row) => Boolean(row?.isRadiant) === radiant)
          .reduce((total, row) => total + (Number(row?.kills) || 0), 0);
      const radiantScore = parsed ? sumOf(match.radiantKills) : killsOf(true);
      const direScore = parsed ? sumOf(match.direKills) : killsOf(false);
      const averageRankTier =
        matchRankTierOf(match) ??
        averageTierOf(players.map((row) => row?.steamAccount?.seasonRank));

      return {
        matchId: String(match.id || matchId),
        startedAt: match.startDateTime
          ? new Date(Number(match.startDateTime) * 1000).toISOString()
          : "",
        durationSeconds: Number(match.durationSeconds || 0),
        radiantWin: Boolean(match.didRadiantWin),
        radiantScore,
        direScore,
        averageRankTier,
        players: players.map((row) => {
          const radiant = Boolean(row?.isRadiant);
          const hidden = Boolean(row?.steamAccount?.isAnonymous);
          const accountId =
            !hidden && row?.steamAccountId ? String(row.steamAccountId) : "";
          const base = toPlayerMatch({ ...match, players: [row] }, accountId);
          const tier = Number(row?.steamAccount?.seasonRank);
          return {
            ...base,
            teamKills: radiant ? radiantScore : direScore,
            teamDeaths: radiant ? direScore : radiantScore,
            averageRankTier,
            accountId,
            personaName: hidden ? "" : String(row?.steamAccount?.name || ""),
            rankTier: Number.isFinite(tier) && tier > 0 ? tier : null,
            level: Number.isFinite(Number(row?.level))
              ? Number(row.level)
              : null,
            netWorth: Number.isFinite(Number(row?.networth))
              ? Number(row.networth)
              : null,
            slot: Number(row?.playerSlot || 0),
            // Stratz gercek pozisyonu verir; takim dagilimi ipucu olarak
            // ayni alani okur (bkz. players/role-assignment.js).
            laneRole: base.role,
            items: [
              row?.item0Id,
              row?.item1Id,
              row?.item2Id,
              row?.item3Id,
              row?.item4Id,
              row?.item5Id,
              row?.neutral0Id,
            ]
              .map((id) => ITEM_BY_ID.get(Number(id)))
              .filter(Boolean),
          };
        }),
        provider: PROVIDER_NAME,
      };
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

    /**
     * Lobideki oyunculari TEK ISTEKTE ceker (mac oncesi risk analizi).
     *
     * GraphQL takma adlariyla (`p0: player(...)`, `p1: ...`) on oyuncunun
     * profili, son maclari ve hero istatistigi ayni sorguda gelir. Oyuncu
     * basina ayri istek atmak bir lobide 20-30 istek demekti; bu yol 1.
     *
     * `withHeroes: false` sorguyu hafifletir (tum zamanlar hero taramasi en
     * pahali kisim); agir sorgu reddedilirse cagiran bununla yeniden dener.
     *
     * @param {string[]} accountIds 32-bit hesap kimlikleri
     * @param {{ matchTake?: number, withHeroes?: boolean }} [lobbyOptions]
     * @returns {Promise<Record<string, import("../live/pre-match-risk.js").FetchedPlayer>>}
     */
    async getLobbyPlayers(accountIds, lobbyOptions = {}) {
      const ids = [...new Set(accountIds.map(Number))].filter(
        (id) => Number.isSafeInteger(id) && id > 0,
      );
      if (!ids.length) {
        return {};
      }
      const take = Math.min(50, Math.max(1, lobbyOptions.matchTake || 20));
      const withHeroes = lobbyOptions.withHeroes !== false;
      const fields = (index) => `
        p${index}: player(steamAccountId: $p${index}) {
          steamAccount { isAnonymous seasonRank }
          matches(request: { take: $take }) {
            id
            startDateTime
            durationSeconds
            players(steamAccountId: $p${index}) { heroId isVictory isRadiant position }
          }
          ${withHeroes ? "heroesPerformance(request: { take: 100000 }, take: 250) { heroId matchCount winCount }" : ""}
        }`;
      const query = `query DotaStatLobby($take: Int!, ${ids
        .map((_, index) => `$p${index}: Long!`)
        .join(", ")}) {${ids.map((_, index) => fields(index)).join("")}
      }`;
      const variables = { take };
      ids.forEach((id, index) => {
        variables["p" + index] = id;
      });

      const data = await graphql(query, variables);
      /** @type {Record<string, any>} */
      const result = {};
      ids.forEach((id, index) => {
        const player = data?.["p" + index];
        const account = player?.steamAccount;
        const rankTier = Number(account?.seasonRank);
        const matches = (Array.isArray(player?.matches) ? player.matches : [])
          .map((match) => {
            const row = match?.players?.[0];
            const heroId = Number(row?.heroId || 0);
            const start = Number(match?.startDateTime || 0);
            return {
              matchId: String(match?.id || ""),
              startedAt: start ? new Date(start * 1000).toISOString() : "",
              durationSeconds: Number(match?.durationSeconds || 0),
              hero: HERO_BY_ID.get(heroId) || "",
              role: POSITION_TO_ROLE_KEY[String(row?.position || "")] || "",
              result: row?.isVictory ? "win" : "loss",
              side: row?.isRadiant ? "radiant" : "dire",
            };
          })
          .filter((match) => match.matchId && match.hero);
        const heroes = withHeroes
          ? (player?.heroesPerformance || [])
              .map((row) => ({
                hero: HERO_BY_ID.get(Number(row?.heroId || 0)) || "",
                matches: Number(row?.matchCount || 0),
                wins: Number(row?.winCount || 0),
              }))
              .filter((row) => row.hero && row.matches > 0)
          : undefined;
        result[String(id)] = {
          matches,
          heroes,
          rankTier: Number.isFinite(rankTier) && rankTier > 0 ? rankTier : null,
          isPrivate:
            !player || Boolean(account?.isAnonymous) || !matches.length,
        };
      });
      return result;
    },
  };
}
