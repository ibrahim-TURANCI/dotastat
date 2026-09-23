/**
 * GET /api/matches/:matchId
 *
 * Tek macin tam kadrosu: iki takim, on oyuncunun hero/KDA/hasar bilgisi ve
 * herkes icin Performance Rank. Mac bir kez cekilir ve suresiz onbellege
 * yazilir; yalnizca kadronun oynadigi maclar icin kaynaga gidilir (bkz.
 * core -> player-data-service -> getMatchDetail).
 */

import { readMatchRoles } from "./_lib/match-roles.mjs";
import { getMatchDetail } from "./_lib/player-data.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  const url = new URL(request.url);
  const matchId =
    url.searchParams.get("matchId") ||
    url.pathname.split("/").filter(Boolean).pop() ||
    "";

  try {
    // Kadrodan birinin bu mac icin elle girdigi pozisyon, takim dagiliminda
    // kesin kabul edilir; kalan pozisyonlar ona gore dagitilir.
    const result = await getMatchDetail(matchId, {
      readForcedRoles: readMatchRoles,
    });
    if (!result.match) {
      return fail(result.error || "mac-detayi-alinamadi", {
        status: result.error === "gecersiz-mac" ? 400 : 404,
      });
    }
    // Mac verisi degismez ama pozisyon beyani degisebilir; CDN'de kisa tutulur
    // ki elle girilen pozisyon dagilima hemen yansisin.
    return json(
      { ok: true, match: result.match, fromCache: result.fromCache },
      { cacheSeconds: 60 },
    );
  } catch (error) {
    return fail("mac-detayi-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
