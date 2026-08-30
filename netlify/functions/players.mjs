/**
 * GET /api/players
 *
 * Oyuncu Degerlendirme ekraninin kart listesi. Ag istegi onbellek uzerinden
 * yapilir; `?refresh=1` ile ilk birkac oyuncu zorla tazelenir.
 */

import { getRosterDashboard } from "./_lib/player-data.mjs";
import {
  consumeRefresh,
  limitMessage,
  requesterKey,
} from "./_lib/rate-limit.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  // Yalnizca ACIK tazeleme sayilir; normal sayfa acilisi onbellekten gelir ve
  // dis kaynaga gitmez, dolayisiyla sinirlanmasi gereksiz olurdu.
  if (refresh) {
    const gate = await consumeRefresh(requesterKey(request));
    if (!gate.ok) {
      const body = limitMessage(gate.retryAfterSeconds);
      return fail(body.error, {
        status: 429,
        message: body.message,
        headers: { "retry-after": String(gate.retryAfterSeconds) },
      });
    }
  }

  try {
    const dashboard = await getRosterDashboard({ refresh });
    return json(
      {
        ok: true,
        ...dashboard,
        // Bu degerler GERCEK MMR DEGILDIR; arayuz her zaman bu sekilde etiketler.
        disclaimer:
          "performanceRank ve performans profili degerleri gercek MMR degildir, seviye tahminidir.",
      },
      { cacheSeconds: refresh ? 0 : 60 },
    );
  } catch (error) {
    return fail("oyuncu-listesi-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
