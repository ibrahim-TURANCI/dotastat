/**
 * Oyuncu kartlarina donem ozeti (Hafta / Ay) ekler.
 *
 * NEDEN AYRI BIR KATMAN: puanlama `@dotastat/core` icinde SAF duruyor — mac
 * listesi, degerlendirmeler ve MMR olcumleri girdi olarak veriliyor. Ama MMR
 * olcumleri ayri bir kovada (`dotastat-mmr`), pozisyon beyani da baska bir
 * kovada duruyor. Bu dosya o uc kaynagi bir araya getirip cekirdege veriyor.
 *
 * Eskiden ayni is "Haftanin Kazanani / Kaybedeni" bolumu icin
 * `/api/weekly` ucunda yapiliyordu. O bolum kaldirildi: ayni sayilari iki ayri
 * yerde iki ayri duzende gostermek yerine oyuncu kartlarinin kendisi donem
 * ozetini tasiyor.
 */

import { buildWeeklyScoreboard, listRoster } from "@dotastat/core";
import { getPlayerBundle } from "./player-data.mjs";
import { readMatchRoles } from "./match-roles.mjs";
import { mmrStore } from "./store.mjs";

/**
 * Kadronun donem siralamasi.
 *
 * AG ISTEGI YAPMAZ (`allowFetch: false`): yalnizca onbellekteki mac verisini
 * okur. Tazeleme karari "Yenile" butonundadir, boylece donem sekmesi arasinda
 * gidip gelmek OpenDota gunluk limitinden harcamaz.
 *
 * @param {{ period?: string }} [options]
 * @returns {Promise<ReturnType<typeof buildWeeklyScoreboard>>}
 */
export async function getPeriodScoreboard(options = {}) {
  const store = mmrStore();

  const entries = await Promise.all(
    listRoster().map(async (player) => {
      const accountId = String(player.player_id);
      // Pozisyon beyani degerlendirmeyi degistirdigi icin burada da okunur:
      // karttaki Performance Rank, detay panelinde gorunen degerle ayni olmali.
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

  return buildWeeklyScoreboard({ entries, period: options.period });
}
