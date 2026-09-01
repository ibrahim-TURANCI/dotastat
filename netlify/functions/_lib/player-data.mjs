/**
 * Oyuncu verisi katmani — Netlify surumu.
 *
 * Is mantigi `@dotastat/core` icindeki `createPlayerDataService` dedir; burada
 * yalnizca depolama olarak Netlify Blobs baglanir. Onbellek TUM ziyaretciler
 * arasinda paylasilir, bu yuzden siteye 10 kisi de girse OpenDota'ya giden
 * istek sayisi degismez.
 */

import { createPlayerDataService } from "@dotastat/core";
import { playerStore } from "./store.mjs";

/** @type {ReturnType<typeof createPlayerDataService>|null} */
let cachedService = null;

/**
 * @returns {ReturnType<typeof createPlayerDataService>}
 */
export function playerDataService() {
  if (!cachedService) {
    cachedService = createPlayerDataService({
      storage: playerStore(),
      apiKey: process.env.OPENDOTA_API_KEY || "",
      // OpenDota gunluk limitine takilinca devreye giren yedek kaynak.
      // Anahtar yoksa zincir Stratz'i sessizce atlar.
      stratzApiKey: process.env.STRATZ_API_KEY || "",
      timeoutMs: 7000,
    });
  }
  return cachedService;
}

export const getPlayerBundle = (player, options) =>
  playerDataService().getPlayerBundle(player, options);

export const getRosterDashboard = (options) =>
  playerDataService().getRosterDashboard(options);

/**
 * Roster istatistiklerinin surec ici hafizasi.
 *
 * NEDEN VAR: `getCachedStatsByPlayerId` kadrodaki HER oyuncu icin ayri bir
 * paket aciyor; olculdu, tek cagri 10 oyuncuda 70 Blobs okumasi yapiyor
 * (onbellek sogukken 110). Bu cagri `/api/live` icinde, mac aktifken HER
 * yoklamada calisiyor ve panel 5 saniyede bir yokluyor — yani izleyici basina
 * dakikada ~850 Blobs okumasi.
 *
 * Donen veri hero istatistigi: dakikalar boyunca sabit. Netlify fonksiyon
 * kabini cagrilar arasinda yeniden kullandigi icin (ayni sebeple `cachedService`
 * de burada duruyor) kisa omurlu bir hafiza yoklamalarin ezici cogunlugunu
 * depoya hic gitmeden karsilar.
 *
 * Kab soguk baslarsa hafiza bostur ve ilk yoklama normal maliyeti oder; bu
 * dogru davranis, veri her zaman en fazla MEMO_TTL_MS kadar eskidir.
 */
const MEMO_TTL_MS = 60 * 1000;

/** @type {{ at: number, value: Record<string, unknown> }|null} */
let statsMemo = null;
/** @type {Promise<Record<string, unknown>>|null} */
let statsInFlight = null;

export const getCachedStatsByPlayerId = () => {
  if (statsMemo && Date.now() - statsMemo.at < MEMO_TTL_MS) {
    return Promise.resolve(statsMemo.value);
  }

  // Ayni anda gelen yoklamalar TEK bir fan-out paylasir; aksi halde soguk
  // kabda es zamanli 5 istek 5 kez 110 okuma yapardi.
  if (!statsInFlight) {
    statsInFlight = playerDataService()
      .getCachedStatsByPlayerId()
      .then((value) => {
        statsMemo = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        statsInFlight = null;
      });
  }

  return statsInFlight;
};
