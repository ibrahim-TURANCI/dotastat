/**
 * GET /api/players/:playerKey
 *
 * Tek oyuncunun detay paketi: profil, karakter notlari, mac bazli Performance
 * Rank degerlendirmeleri, hero havuzu istatistigi ve sinerji kayitlari.
 */

import { findRosterPlayer, listSynergiesForPlayer } from "@dotastat/core";
import { getPlayerBundle } from "./_lib/player-data.mjs";
import { readMatchRoles, sessionAccountId } from "./_lib/match-roles.mjs";
import { readSession } from "./_lib/session.mjs";
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

  // Bakilan oyuncu, giris yapmis kullanicinin KENDISI ise onun pozisyon
  // beyanlari degerlendirmeye katilir. Baskasinin sayfasinda bu kayitlar
  // okunmaz; herkes yalnizca kendi beyanini etkiler.
  const session = readSession(request);
  const viewerAccountId = session ? sessionAccountId(session) : "";
  const isOwnProfile =
    Boolean(viewerAccountId) && viewerAccountId === String(player.player_id);
  const forcedRoles = isOwnProfile ? await readMatchRoles(viewerAccountId) : {};

  try {
    const bundle = await getPlayerBundle(player, { refresh, forcedRoles });
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
