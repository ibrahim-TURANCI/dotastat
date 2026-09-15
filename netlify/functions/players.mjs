/**
 * GET /api/players
 *
 * Oyuncu Degerlendirme ekraninin kart listesi. Ag istegi onbellek uzerinden
 * yapilir; `?refresh=1` ile ilk birkac oyuncu zorla tazelenir.
 *
 * `?period=week|month` secilen doneme gore her karta bir OZET ekler (puan,
 * G/M, MMR degisimi, Performance Rank, mac sayisi) ve kartlari PUANA gore
 * siralar. Eskiden ayni sayilar ayri bir "Haftanin Kazanani / Kaybedeni"
 * bolumunde duruyordu; ayni bilgiyi iki ayri duzende gostermek yerine artik
 * kartlarin kendisi tasiyor.
 */

import { withPeriodSummary } from "@dotastat/core";
import { getRosterDashboard } from "./_lib/player-data.mjs";
import { getPeriodScoreboard } from "./_lib/period-summary.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const period = url.searchParams.get("period") || "";

  try {
    // Kartlar ONCE uretilir: donem ozeti ayni onbellekten okunuyor ve
    // tazeleme sonrasi taze veriyi gormesi gerekiyor.
    const dashboard = await getRosterDashboard({ refresh });
    const board = await getPeriodScoreboard({ period });

    return json(
      {
        ok: true,
        ...dashboard,
        cards: withPeriodSummary(dashboard.cards, board),
        period: board.period,
        periodLabel: board.periodLabel,
        periodDays: board.windowDays,
        periodSince: board.since,
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
