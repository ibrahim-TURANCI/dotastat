/**
 * Canli mac baglami.
 *
 * Normalize edilmis GSI durumunu roster ile birlestirir: maca giren
 * oyunculardan hangileri arkadas grubundan, hangi takimda, hangi hero ile.
 * Sonuc hem web arayuzunde (canli mac paneli) hem de draft asistaninda
 * kullanilir.
 */

import { findRosterPlayer, toAccountId } from "../players/roster.js";
import { heroDisplayName, normalizeHeroKey } from "../heroes/hero-names.js";
import { buildDraftAdvice, resolveDraftStage } from "../draft/draft-advisor.js";

/** Bu suredir guncellenmemis canli mac "bitmis" sayilir. */
export const LIVE_MATCH_TTL_MS = 3 * 60 * 1000;

/**
 * @param {{ updatedAt?: string }|null} liveState
 * @param {number} [ttlMs]
 * @returns {boolean}
 */
export function isLiveMatchFresh(liveState, ttlMs = LIVE_MATCH_TTL_MS) {
  if (!liveState?.updatedAt) {
    return false;
  }
  const age = Date.now() - new Date(liveState.updatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

/**
 * Canli mactaki bir oyuncuyu roster ile eslestirir.
 * @param {Record<string, any>} livePlayer
 */
function matchToRoster(livePlayer) {
  const accountId =
    String(livePlayer?.accountId || "") ||
    toAccountId(livePlayer?.steamId || "");
  if (!accountId) {
    return null;
  }
  return findRosterPlayer(accountId);
}

/**
 * @param {Object} input
 * @param {Record<string, any>|null} input.liveState normalizeGsiPayload ciktisi
 * @param {Record<string, Object>} [input.statsByPlayerId] roster id -> PlayerStats
 * @param {string} [input.viewerSteamId] Sayfayi acan kisinin SteamID64'u
 */
export function buildLiveMatchContext(input = {}) {
  const liveState = input.liveState || null;
  const statsByPlayerId = input.statsByPlayerId || {};

  if (!liveState) {
    return { active: false, reason: "no-live-state" };
  }

  const fresh = isLiveMatchFresh(liveState);
  const allPlayers = [
    ...(liveState.radiantPlayers || []),
    ...(liveState.direPlayers || []),
  ];

  /** @type {Array<{ player: Object, team: string, slot: number|null, hero: string, live: Object, stats: Object|null }>} */
  const knownPlayers = [];
  const decorated = allPlayers.map((livePlayer) => {
    const rosterPlayer = matchToRoster(livePlayer);
    const row = {
      ...livePlayer,
      heroName: heroDisplayName(livePlayer.hero),
      roster: rosterPlayer
        ? {
            id: rosterPlayer.id,
            name: rosterPlayer.name,
            playerId: rosterPlayer.player_id,
            primaryRole: rosterPlayer.dotaProfile?.primaryRole || "",
            rank: rosterPlayer.rank || null,
          }
        : null,
    };

    if (rosterPlayer) {
      knownPlayers.push({
        player: rosterPlayer,
        team: livePlayer.team,
        slot: livePlayer.slot,
        hero: normalizeHeroKey(livePlayer.hero),
        role: rosterPlayer.dotaProfile?.primaryRole || "",
        stats: statsByPlayerId[rosterPlayer.id] || null,
        live: livePlayer,
      });
    }

    return row;
  });

  // Arkadaslarin cogunlukta oldugu taraf "bizim takim" sayilir. Hicbiri yoksa
  // sayfayi acan kisinin takimina, o da yoksa radiant'a dusulur.
  const radiantKnown = knownPlayers.filter(
    (row) => row.team === "radiant",
  ).length;
  const direKnown = knownPlayers.filter((row) => row.team === "dire").length;
  let myTeam = radiantKnown >= direKnown ? "radiant" : "dire";
  if (radiantKnown === 0 && direKnown === 0 && input.viewerSteamId) {
    const viewer = allPlayers.find(
      (row) => String(row.steamId) === String(input.viewerSteamId),
    );
    if (viewer) {
      myTeam = viewer.team;
    }
  }

  const draftStage = resolveDraftStage({
    picks: liveState.draft?.picks || [],
    phase: liveState.phase,
  });

  const draftAdvice = buildDraftAdvice({
    myTeam,
    picks: liveState.draft?.picks || [],
    bans: liveState.draft?.bans || [],
    phase: liveState.phase,
    knownPlayers,
  });

  return {
    active: fresh,
    stale: !fresh,
    matchId: liveState.matchId || "",
    phase: liveState.phase,
    gameTime: liveState.gameTime,
    score: {
      radiant: liveState.radiantScore,
      dire: liveState.direScore,
    },
    myTeam,
    updatedAt: liveState.updatedAt,
    radiantPlayers: decorated.filter((row) => row.team === "radiant"),
    direPlayers: decorated.filter((row) => row.team === "dire"),
    knownPlayerIds: knownPlayers.map((row) => row.player.id),
    draft: {
      stage: draftStage,
      picks: liveState.draft?.picks || [],
      bans: liveState.draft?.bans || [],
    },
    draftAdvice,
  };
}
