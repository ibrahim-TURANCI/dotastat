/**
 * GET /api/players/:playerKey
 *
 * Tek oyuncunun detay paketi: profil, karakter notlari, mac bazli Performance
 * Rank degerlendirmeleri, hero havuzu istatistigi ve sinerji kayitlari.
 */

import {
  attributeMmrToMatches,
  findRosterPlayer,
  listSynergiesForPlayer,
  resolveRankProgress,
} from "@dotastat/core";
import { getPlayerBundle } from "./_lib/player-data.mjs";
import { readMatchRoles, sessionAccountId } from "./_lib/match-roles.mjs";
import { readSession } from "./_lib/session.mjs";
import { mmrStore } from "./_lib/store.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  const url = new URL(request.url);
  const playerKey =
    url.searchParams.get("playerKey") ||
    url.pathname.split("/").filter(Boolean).pop() ||
    "";

  const player = findRosterPlayer(playerKey);
  if (!player) {
    return fail("oyuncu-bulunamadi", { status: 404 });
  }

  const refresh = url.searchParams.get("refresh") === "1";

  // BAKILAN oyuncunun kendi pozisyon beyanlari her ziyaretcide okunur:
  // degerlendirme kim bakiyor diye degismemeli. Steam girisi yalnizca YAZMA
  // yetkisini belirler — kisi ancak kendi maclarina pozisyon isaretleyebilir.
  const session = readSession(request);
  const viewerAccountId = session ? sessionAccountId(session) : "";
  const isOwnProfile =
    Boolean(viewerAccountId) && viewerAccountId === String(player.player_id);
  const forcedRoles = await readMatchRoles(String(player.player_id));

  try {
    const bundle = await getPlayerBundle(player, { refresh, forcedRoles });

    // MMR HERKESE gosterilir: kayit oyuncunun KENDI hesabina yazilmistir
    // (bkz. mmr.mjs — anahtar oturum cerezinden gelir), okumak icin ayni
    // kisi olmak gerekmez. Kimlik dogrulamasi yazma tarafinda durur.
    const samples =
      (await mmrStore().get("mmr:" + String(player.player_id)))?.samples || [];
    const mmrByMatch = attributeMmrToMatches({
      matches: bundle.matches,
      samples,
    });
    // Madalyanin yanindaki MMR ve "kalan rank". Kurulumu olmayan oyuncuda
    // deger madalyadan TURETILIR ve `approximate` ile isaretlenir.
    const mmrProgress = resolveRankProgress({
      samples,
      rank: bundle.player?.rank || null,
    });
    return json(
      {
        ok: true,
        player: bundle.player,
        form: bundle.form,
        effectivePotential: bundle.effectivePotential,
        stats: bundle.stats,
        heroPool: bundle.heroPool,
        matches: bundle.matches.slice(0, 25),
        evaluations: bundle.evaluations.slice(0, 25),
        synergies: listSynergiesForPlayer(player.id),
        // Arayuz pozisyon secicisini yalnizca kendi sayfasinda gosterir.
        canEditRoles: isOwnProfile,
        matchRoles: forcedRoles,
        historyUnavailable: bundle.historyUnavailable,
        mmrByMatch,
        mmrProgress,
        refreshSkipped: bundle.refreshSkipped,
        refreshAvailableInMs: bundle.refreshAvailableInMs,
        fetchedAt: bundle.fetchedAt,
        fromCache: bundle.fromCache,
        provider: bundle.provider,
        providerError: bundle.providerError,
        heroPerformanceError: bundle.heroPerformanceError,
      },
      // Kisiye ozel alan (canEditRoles/matchRoles) iceren yanit CDN'de
      // paylasilmamali; bu yuzden kendi sayfanda onbellek kapatilir.
      { cacheSeconds: refresh || isOwnProfile ? 0 : 60 },
    );
  } catch (error) {
    return fail("oyuncu-detayi-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
