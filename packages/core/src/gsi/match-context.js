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
 * Ayni anda birden fazla canli mac varsa SAYFAYI ACAN KISIYE gore secer.
 *
 * NEDEN GEREKLI: masaustu uygulamasini kuran herkes kendi macini siteye
 * gonderiyor ve her kayit ayri tutuluyor. Eskiden site "en son guncellenen"
 * kaydi herkese gosteriyordu; uc arkadas uc ayri mactayken panel saniyede bir
 * baska maca zipliyordu, cunku hepsi surekli veri gonderiyor.
 *
 * Oncelik sirasi:
 *   1. Izleyicinin KENDI gonderdigi mac
 *   2. Izleyicinin oyuncu olarak icinde bulundugu mac
 *   3. Kadrodan en cok taninan oyuncuyu iceren mac (arkadaslarin maci)
 *   4. Hicbiri yoksa en taze mac
 *
 * @param {Array<Record<string, any>>} states Taze canli mac kayitlari
 * @param {{ viewerSteamId?: string }} [options]
 * @returns {Record<string, any>|null}
 */
export function selectLiveStateForViewer(states, options = {}) {
  const rows = (Array.isArray(states) ? states : []).filter(Boolean);
  if (!rows.length) {
    return null;
  }

  const viewer = String(options.viewerSteamId || "").trim();
  const freshness = (row) => new Date(row?.updatedAt || 0).getTime() || 0;
  const byFreshest = (a, b) => freshness(b) - freshness(a);

  const playersOf = (row) => [
    ...(row?.radiantPlayers || []),
    ...(row?.direPlayers || []),
  ];

  if (viewer) {
    const own = rows
      .filter((row) => String(row?.uploaderSteamId || "") === viewer)
      .sort(byFreshest)[0];
    if (own) {
      return own;
    }

    const playing = rows
      .filter((row) =>
        playersOf(row).some(
          (player) => String(player?.steamId || "") === viewer,
        ),
      )
      .sort(byFreshest)[0];
    if (playing) {
      return playing;
    }
  }

  // Kadrodan kac taninan oyuncu var? Cok olan once gelir, esitlikte taze olan.
  const scored = rows
    .map((row) => ({
      row,
      known: playersOf(row).filter((player) => matchToRoster(player)).length,
    }))
    .sort((a, b) => b.known - a.known || byFreshest(a.row, b.row));

  return scored[0].row;
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
    // Overwolf/DotaPlus'tan gelen ek baglam (kurulu degilse `null`):
    // hangi tarafta oynadigimiz, parti, mac modu. Arayuz bununla "hero
    // bilgisi Overwolf'tan geliyor" notunu gosterebilir.
    overwolf: liveState.overwolf || null,
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
