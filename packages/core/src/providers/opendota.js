/**
 * OpenDota veri kaynagi.
 *
 * API anahtari gerektirmez (anahtar verilirse rate limit yukselir). Yalnizca
 * global `fetch` kullanir; bu sayede Netlify Function, Electron ana sureci ve
 * tarayici tarafinda ayni kod calisir.
 *
 * Onbellek burada TUTULMAZ. Onbellekleme kararini cagiran katman verir
 * (Netlify Functions -> Netlify Blobs, Electron -> disk).
 */

import bundledHeroIds from "../data/hero-ids.js";
import { LANE_ROLE_TO_ROLE_KEY } from "../players/player-types.js";
import { buildStatsFromMatches } from "./match-stats.js";
import {
  codeFromStatus,
  providerError,
  RATE_LIMIT,
  UNAVAILABLE,
} from "./provider-errors.js";

const API_BASE = "https://api.opendota.com/api";
export const PROVIDER_NAME = "opendota";

/** `/recentMatches` ucunun dondurdugu maksimum satir sayisi. */
const RECENT_MATCHES_MAX = 20;

/** `/matches` ucu dar alan seti doner; eksik alanlar project ile istenir. */
const MATCH_PROJECTION = [
  "hero_id",
  "kills",
  "deaths",
  "assists",
  "denies",
  "duration",
  "start_time",
  "gold_per_min",
  "xp_per_min",
  "hero_damage",
  "hero_healing",
  "tower_damage",
  "last_hits",
  "lane_role",
  "is_roaming",
  "player_slot",
  "radiant_win",
]
  .map((field) => `project=${field}`)
  .join("&");

/**
 * Saglayicinin vermedigi sayisal alanlar icin `null` dondurur.
 *
 * `Number(undefined || 0)` yazmak eksik veriyi 0'a cevirir; bu da "hic ward
 * dikmemis" gibi okunup oyuncuyu haksiz yere cezalandirir. Bilinmeyeni
 * bilinmeyen olarak tasimak icin bu yardimci kullanilir.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function optionalNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Paketlenmis hero tablosu taban; ag yoksa da hero isimleri dogru gorunur. */
const HERO_BY_ID = new Map(
  Object.entries(bundledHeroIds).map(([id, name]) => [
    Number(id),
    String(name),
  ]),
);

/**
 * @param {{ apiKey?: string, timeoutMs?: number }} [options]
 */
export function createOpenDotaClient(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const timeoutMs = Number(options.timeoutMs) || 8000;

  /**
   * @param {string} pathName `/players/123` gibi, bas taraftaki / dahil
   * @returns {Promise<unknown>}
   */
  async function requestJson(pathName) {
    const separator = pathName.includes("?") ? "&" : "?";
    const url = apiKey
      ? `${API_BASE}${pathName}${separator}api_key=${encodeURIComponent(apiKey)}`
      : `${API_BASE}${pathName}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw providerError(
          `opendota-${response.status}`,
          codeFromStatus(response.status),
          PROVIDER_NAME,
        );
      }
      const payload = await response.json();
      // Limit asimini 200 + { error } olarak da dondurebiliyor.
      if (payload && !Array.isArray(payload) && payload.error) {
        const text = String(payload.error);
        throw providerError(
          `opendota-${text}`,
          /limit|quota|exceeded|throttl/i.test(text) ? RATE_LIMIT : UNAVAILABLE,
          PROVIDER_NAME,
        );
      }
      return payload;
    } catch (error) {
      // Timeout / ag hatasi kod tasimaz; bunlari "gecici erisilemez" sayariz
      // ki zincir bir sonraki saglayiciya gecebilsin.
      if (!(/** @type {any} */ (error)?.code)) {
        throw providerError(
          String(/** @type {any} */ (error)?.message || "opendota-hatasi"),
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
   * OpenDota `lane_role` + `is_roaming` -> RoleKey
   * @param {Record<string, any>} row
   * @returns {string}
   */
  function resolveRole(row) {
    if (row?.is_roaming) {
      return "pos4";
    }
    return LANE_ROLE_TO_ROLE_KEY[Number(row?.lane_role || 0)] || "";
  }

  /**
   * @param {Record<string, any>} row
   * @returns {boolean}
   */
  function isWin(row) {
    if (row?.win !== undefined) {
      return Number(row.win) === 1;
    }
    const radiant = Number(row?.player_slot || 0) < 128;
    return Boolean(row?.radiant_win) === radiant;
  }

  /**
   * @param {Record<string, any>} row
   * @param {string} playerId
   * @returns {import("../players/player-types.js").PlayerMatch}
   */
  function toPlayerMatch(row, playerId) {
    const heroId = Number(row?.hero_id || 0);
    const startTime = Number(row?.start_time || 0);

    return {
      matchId: String(row?.match_id || ""),
      playerId,
      startedAt: startTime
        ? new Date(startTime * 1000).toISOString()
        : new Date().toISOString(),
      durationSeconds: Number(row?.duration || 0),
      hero: HERO_BY_ID.get(heroId) || (heroId ? `hero_${heroId}` : ""),
      role: resolveRole(row),
      result: isWin(row) ? "win" : "loss",
      kills: Number(row?.kills || 0),
      deaths: Number(row?.deaths || 0),
      assists: Number(row?.assists || 0),
      gpm: Number(row?.gold_per_min || 0),
      xpm: Number(row?.xp_per_min || 0),
      heroDamage: Number(row?.hero_damage || 0),
      heroHealing: Number(row?.hero_healing || 0),
      towerDamage: Number(row?.tower_damage || 0),
      lastHits: Number(row?.last_hits || 0),
      denies: Number(row?.denies || 0),
      // Ward/kamp verisi OpenDota'nin bu iki ucundan HIC gelmez:
      //   /recentMatches      -> alanlar listesinde yok
      //   /matches?project=... -> obs_placed / sen_placed projeksiyonu
      //                           sessizce dusuruluyor
      // Yalnizca parse edilmis maclarin detayinda (/matches/{id}) bulunur ki
      // o da mac basina bir istek demek. Bu yuzden 0 DEGIL null yaziyoruz:
      // "sifir ward dikti" ile "bilmiyoruz" ayni sey degil. Degerlendirme
      // motoru null gorunce vision faktorunu tamamen devre disi birakir
      // (bkz. performance-evaluation-engine.js -> buildFactors).
      obsPlaced: optionalNumber(row?.obs_placed),
      senPlaced: optionalNumber(row?.sen_placed),
      campsStacked: optionalNumber(row?.camps_stacked),
      teamKills: Number(row?.team_kills || 0),
      teamDeaths: 0,
      laneResult: "",
      provider: PROVIDER_NAME,
    };
  }

  return {
    name: PROVIDER_NAME,
    label: "OpenDota",

    /**
     * Profil + rank madalyasi. Profil gizliyse rank_tier yine gelebilir.
     * @param {string} playerId 32-bit account id
     */
    async getPlayerProfile(playerId) {
      const payload = await requestJson(`/players/${playerId}`);
      if (!payload || typeof payload !== "object") {
        return null;
      }

      const profile = payload.profile || null;
      const rankTier = Number(payload.rank_tier);
      const leaderboardRank = Number(payload.leaderboard_rank);
      if (!profile && !Number.isFinite(rankTier)) {
        return null;
      }

      return {
        playerId: String(playerId),
        name: String(profile?.personaname || ""),
        avatar: String(profile?.avatarfull || profile?.avatar || ""),
        steamId: String(profile?.steamid || ""),
        // Dota'daki "Expose Public Match Data" ayari kapaliysa OpenDota bu
        // bayragi kaldirir: profil ve rank gorunur ama MAC LISTESI hep bos
        // doner. Bunu tasimazsak oyuncu ekranda sonsuza kadar "veri
        // bekleniyor" olarak kalir ve her acilista bosuna istek denenir.
        historyUnavailable: Boolean(profile?.fh_unavailable),
        rankTier: Number.isFinite(rankTier) ? rankTier : null,
        leaderboardRank: Number.isFinite(leaderboardRank)
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
      const limit = Math.min(
        100,
        Math.max(1, Number(matchOptions.limit) || 20),
      );
      const payload =
        limit <= RECENT_MATCHES_MAX
          ? await requestJson(`/players/${playerId}/recentMatches`)
          : await requestJson(
              `/players/${playerId}/matches?limit=${limit}&${MATCH_PROJECTION}`,
            );

      const rows = Array.isArray(payload) ? payload : [];
      return rows
        .slice(0, limit)
        .map((row) => toPlayerMatch(row, String(playerId)))
        .filter((row) => row.matchId);
    },

    /**
     * @param {string} playerId
     * @param {{ limit?: number }} [statsOptions]
     */
    async getPlayerStats(playerId, statsOptions = {}) {
      const limit = Math.min(
        100,
        Math.max(1, Number(statsOptions.limit) || 100),
      );
      const payload = await requestJson(
        `/players/${playerId}/matches?limit=${limit}&${MATCH_PROJECTION}`,
      );
      const rows = Array.isArray(payload) ? payload : [];
      const matches = rows.map((row) => toPlayerMatch(row, String(playerId)));
      return buildStatsFromMatches(String(playerId), matches, PROVIDER_NAME);
    },

    /**
     * TUM zamanlarin hero istatistigi (`/players/{id}/heroes`).
     *
     * Son maclarla karistirilmamali: imza kahraman secimi bu listeye bakar,
     * cunku "kariyeri boyunca en cok oynadigi ve kazandigi hero" sorusunun
     * cevabi son 60 macta degil burada durur.
     *
     * @param {string} playerId
     * @returns {Promise<import("../players/player-types.js").HeroPerformanceRow[]>}
     */
    async getHeroPerformance(playerId) {
      const payload = await requestJson(`/players/${playerId}/heroes`);
      const rows = Array.isArray(payload) ? payload : [];
      return rows
        .map((row) => {
          const heroId = Number(row?.hero_id || 0);
          const games = Number(row?.games || 0);
          const wins = Number(row?.win || 0);
          return {
            hero: HERO_BY_ID.get(heroId) || (heroId ? `hero_${heroId}` : ""),
            matches: games,
            wins,
            winRate: games ? Number((wins / games).toFixed(4)) : 0,
            avgKda: 0,
            provider: PROVIDER_NAME,
          };
        })
        .filter((row) => row.hero && row.matches > 0)
        .sort((a, b) => b.matches - a.matches);
    },

    /**
     * Canli mac arama: OpenDota `/live` ucu profesyonel maclari dondurur,
     * pub maclarda ise account id ile eslesme genelde bos doner. Bu yuzden
     * canli veri asil olarak GSI'dan gelir; burasi yalnizca yedek yoldur.
     * @param {string[]} accountIds
     */
    async findLiveMatch(accountIds) {
      const wanted = new Set(accountIds.map((id) => String(id)));
      const payload = await requestJson("/live");
      const rows = Array.isArray(payload) ? payload : [];
      for (const row of rows) {
        const players = Array.isArray(row?.players) ? row.players : [];
        if (players.some((p) => wanted.has(String(p?.account_id || "")))) {
          return row;
        }
      }
      return null;
    },
  };
}
