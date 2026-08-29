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

export const getCachedStatsByPlayerId = () =>
  playerDataService().getCachedStatsByPlayerId();
