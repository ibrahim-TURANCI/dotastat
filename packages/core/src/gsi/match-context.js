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
import { buildLiveItemAdvice } from "../live/item-advice.js";

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
 * "Bizim taraf" hangisi?
 *
 * ONCELIK SIRASI, sinyalin ne kadar DOGRUDAN oldugu ile belirlenir:
 *
 *   1. Sayfayi acan kisi macin icindeyse kendi tarafi. Tartisma yok.
 *   2. Overwolf'un bildirdigi taraf. Veriyi yollayan istemci kendi tarafini
 *      oyundan OKUYOR; bu bir tahmin degil, olcum.
 *   3. Veriyi yollayan kisinin (uploader) mac icindeki satiri. Overwolf yoksa
 *      GSI'nin `localSteamId` degeri hala kimin gonderdigini soyler.
 *   4. Kadrodan taninan oyuncularin cogunlukta oldugu taraf.
 *   5. Radiant.
 *
 * ESKIDEN 4. ADIM ILK SIRADAYDI ve digerleri yalnizca kadrodan HIC KIMSE
 * bulunamadiginda devreye giriyordu. Bu, tek bir kadro oyuncusunun bile
 * yanlis eslesmesi (ya da rakip tarafta bir kadro oyuncusunun bulunmasi)
 * halinde paneli yanlis tarafa kilitliyordu: MABOSS radiant'ta oynarken
 * panel dire'yi "bizim taraf" gosteriyordu. Dogrudan olculmus bir sinyal
 * varken sayim heuristigine bakmak yanlisti.
 *
 * @param {Object} args
 * @param {Record<string, any>} args.liveState
 * @param {Array<Record<string, any>>} args.allPlayers
 * @param {Array<{ team: string }>} args.knownPlayers
 * @param {{ viewerSteamId?: string }} args.input
 * @returns {"radiant"|"dire"}
 */
function resolveMyTeam({ liveState, allPlayers, knownPlayers, input }) {
  const teamOfSteamId = (steamId) => {
    const id = String(steamId || "").trim();
    if (!id) {
      return "";
    }
    const row = allPlayers.find((player) => String(player.steamId) === id);
    return row?.team || "";
  };

  const viewerTeam = teamOfSteamId(input.viewerSteamId);
  if (viewerTeam) {
    return viewerTeam;
  }

  const overwolfTeam = String(liveState.overwolf?.myTeam || "");
  if (overwolfTeam === "radiant" || overwolfTeam === "dire") {
    return overwolfTeam;
  }

  // Birden fazla yayinci olabilir; ilk eslesen yeterlidir, hepsi ayni macta.
  const uploaders = liveState.uploaders?.length
    ? liveState.uploaders
    : [liveState.uploaderSteamId, liveState.localSteamId];
  for (const uploader of uploaders) {
    const team = teamOfSteamId(uploader);
    if (team) {
      return team;
    }
  }

  const radiantKnown = knownPlayers.filter(
    (row) => row.team === "radiant",
  ).length;
  const direKnown = knownPlayers.filter((row) => row.team === "dire").length;
  if (radiantKnown !== direKnown) {
    return radiantKnown > direKnown ? "radiant" : "dire";
  }

  return "radiant";
}

/**
 * @param {Object} input
 * @param {Record<string, any>|null} input.liveState normalizeGsiPayload ciktisi
 * @param {Record<string, Object>} [input.statsByPlayerId] roster id -> PlayerStats
 * @param {string} [input.viewerSteamId] Sayfayi acan kisinin SteamID64'u
 * @param {Record<string, { add?: string[], remove?: string[] }>} [input.itemPlanOverrides]
 *   Hero basina elle duzenlenmis item tavsiyesi ("Tavsiyeleri yonet").
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

  const myTeam = resolveMyTeam({ liveState, allPlayers, knownPlayers, input });

  const itemAdvice = buildLiveItemAdvice({
    radiantPlayers: decorated.filter((row) => row.team === "radiant"),
    direPlayers: decorated.filter((row) => row.team === "dire"),
    myTeam,
    overrides: input.itemPlanOverrides || {},
  });

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
    radiantPlayers: itemAdvice.radiantPlayers,
    direPlayers: itemAdvice.direPlayers,
    // Item tavsiyesi ve takim analizi. Ikisi de ELDEKI VERIYE gore olceklenir
    // (bkz. live/item-advice.js): Overwolf yoksa rakip hero gorunmez ve
    // yalnizca hero planindan birkac oneri cikar.
    itemAdviceLevel: itemAdvice.dataLevel,
    teamAnalysis: itemAdvice.teamAnalysis,
    knownPlayerIds: knownPlayers.map((row) => row.player.id),
    draft: {
      stage: draftStage,
      picks: liveState.draft?.picks || [],
      bans: liveState.draft?.bans || [],
    },
    draftAdvice,
  };
}
