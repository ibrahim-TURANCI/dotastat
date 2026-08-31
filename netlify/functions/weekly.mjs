/**
 * GET /api/weekly
 *
 * Haftanin Kazanani / Kaybedeni tablosu: kadronun son 7 gunluk ozeti ve
 * Weekly Score siralamasi.
 *
 * AG ISTEGI YAPMAZ. Yalnizca onbellekteki mac verisini okur; tazeleme karari
 * "Oyuncu Degerlendirme" ekranindaki Yenile butonundadir. Boylece bu bolum
 * OpenDota gunluk limitinden hic harcamaz.
 */

import { buildWeeklyScoreboard, listRoster } from "@dotastat/core";
import { getPlayerBundle } from "./_lib/player-data.mjs";
import { readMatchRoles } from "./_lib/match-roles.mjs";
import { mmrStore } from "./_lib/store.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  try {
    const store = mmrStore();

    const entries = await Promise.all(
      listRoster().map(async (player) => {
        const accountId = String(player.player_id);
        // Pozisyon beyani degerlendirmeyi degistirdigi icin burada da
        // okunur: haftalik Performance Rank, detay panelinde gorunen degerle
        // ayni olmali.
        const [forcedRoles, mmrRow] = await Promise.all([
          readMatchRoles(accountId),
          store.get("mmr:" + accountId),
        ]);
        const bundle = await getPlayerBundle(player, {
          allowFetch: false,
          forcedRoles,
        });
        return {
          player: bundle.player,
          matches: bundle.matches,
          evaluations: bundle.evaluations,
          samples: mmrRow?.samples || [],
        };
      }),
    );

    const board = buildWeeklyScoreboard({ entries });

    return json(
      {
        ok: true,
        ...board,
        disclaimer:
          "Weekly Score gercek MMR degildir; MMR degisimi, galibiyet dengesi, " +
          "Performance Rank degisimi ve oynanan mac sayisindan hesaplanir.",
      },
      // Onbellekten uretiliyor; kisiye ozel alan yok, paylasilabilir.
      { cacheSeconds: 60 },
    );
  } catch (error) {
    return fail("haftalik-tablo-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
