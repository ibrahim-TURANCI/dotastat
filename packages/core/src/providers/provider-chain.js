/**
 * Sirali saglayici zinciri.
 *
 * Ayni sozlesmeyi uygulayan birden fazla kaynagi (OpenDota, Stratz) tek bir
 * istemci gibi gosterir. Ilk saglayici gunluk limite takilir ya da gecici
 * olarak erisilemez olursa istek sonrakine duser.
 *
 * Kurallar:
 *   - `NOT_FOUND` (oyuncu gercekten yok) zinciri DURDURUR; baska kaynak da
 *     bulamayacagi icin bosuna istek atilmaz.
 *   - Anahtari olmayan saglayici (`isConfigured === false`) hic denenmez.
 *   - Son saglayici da basarisiz olursa ilk hatanin kendisi firlatilir;
 *     boylece cagiran katman "limit doldu" mesajini gorebilir.
 *
 * `lastUsedProvider` alani hangi kaynagin cevap verdigini tutar; arayuzde
 * "veri Stratz'tan geldi" rozetini gostermek icin kullanilir.
 */

import { shouldFailover } from "./provider-errors.js";

/** Zincirin destekledigi metotlar. Hepsi ayni imzayi tasir. */
const CHAINED_METHODS = [
  "getPlayerProfile",
  "getRecentMatches",
  "getPlayerStats",
  "getHeroPerformance",
];

/**
 * @param {Array<Record<string, any>>} providers Oncelik sirasiyla
 * @param {{ onFailover?: (info: { provider: string, code: string, message: string }) => void }} [options]
 */
export function createProviderChain(providers, options = {}) {
  const chain = (Array.isArray(providers) ? providers : []).filter(Boolean);
  if (!chain.length) {
    throw new Error("provider-chain: en az bir saglayici gerekli");
  }

  const onFailover =
    typeof options.onFailover === "function" ? options.onFailover : null;

  /** @type {{ provider: string, code: string, message: string }[]} */
  const failures = [];
  let lastUsedProvider = "";

  /**
   * Bir metodu zincir boyunca dener.
   * @param {string} method
   * @param {unknown[]} args
   */
  async function callChained(method, args) {
    /** @type {unknown} */
    let firstError = null;

    for (const provider of chain) {
      // Anahtari olmayan saglayici (ornek: STRATZ_API_KEY bos) atlanir.
      if (provider.isConfigured === false) {
        continue;
      }
      if (typeof provider[method] !== "function") {
        continue;
      }

      try {
        const result = await provider[method](...args);
        lastUsedProvider = String(provider.name || "");
        return result;
      } catch (error) {
        const info = {
          provider: String(provider.name || ""),
          code: String(/** @type {any} */ (error)?.code || "unknown"),
          message: String(/** @type {any} */ (error)?.message || error),
        };
        failures.push(info);
        if (onFailover) {
          onFailover(info);
        }

        if (!firstError) {
          firstError = error;
        }
        // Kalici hatada (oyuncu yok) sonraki kaynagi denemenin anlami yok.
        if (!shouldFailover(error)) {
          throw error;
        }
      }
    }

    throw (
      firstError || new Error("provider-chain: kullanilabilir saglayici yok")
    );
  }

  /** @type {Record<string, any>} */
  const client = {
    name: "chain",
    label: chain.map((provider) => provider.label || provider.name).join(" → "),

    /** Zincirdeki saglayici adlari (oncelik sirasi). */
    providers: chain.map((provider) => ({
      name: String(provider.name || ""),
      label: String(provider.label || provider.name || ""),
      configured: provider.isConfigured !== false,
    })),

    /** Son basarili istegi hangi saglayici karsiladi? */
    get lastUsedProvider() {
      return lastUsedProvider;
    },

    /** Bu istemcinin omru boyunca yasanan saglayici hatalari. */
    get failures() {
      return [...failures];
    },
  };

  for (const method of CHAINED_METHODS) {
    client[method] = (...args) => callChained(method, args);
  }

  // Zincirlenmeyen uclar (ornek: OpenDota'ya ozel canli mac aramasi) ilk
  // destekleyen saglayicidan aynen gecirilir.
  const passthrough = chain.find(
    (provider) => typeof provider.findLiveMatch === "function",
  );
  if (passthrough) {
    client.findLiveMatch = (...args) => passthrough.findLiveMatch(...args);
  }

  // Tarama istegi zincirlenmez: destekleyen TUM saglayicilara gonderilir ve
  // sonuc beklenmez. Amac veriyi almak degil, kaynagi tetiklemek.
  client.requestRefresh = async (...args) => {
    await Promise.all(
      chain
        .filter(
          (provider) =>
            provider.isConfigured !== false &&
            typeof provider.requestRefresh === "function",
        )
        .map((provider) => provider.requestRefresh(...args).catch(() => false)),
    );
  };

  return client;
}
