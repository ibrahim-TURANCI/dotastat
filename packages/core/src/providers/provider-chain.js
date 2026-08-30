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
   *
   * `accept` verilirse yalnizca HATA degil, YETERSIZ SONUC da sonraki
   * saglayiciya gecme sebebidir. Bu gerekli, cunku bir saglayici "basarili"
   * yanit verip aradigimiz veriyi icermeyebiliyor: OpenDota yeni maclari kendi
   * programina gore aliyor ve saatlerce eksik donebiliyor — hata vermeden.
   *
   * @param {string} method
   * @param {unknown[]} args
   * @param {{ accept?: (result: unknown) => boolean }} [options]
   */
  async function callChained(method, args, options = {}) {
    /** @type {unknown} */
    let firstError = null;
    /** @type {unknown} */
    let rejected = null;
    let hasRejected = false;
    const accept = typeof options.accept === "function" ? options.accept : null;

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

        // Sonuc aranan veriyi icermiyorsa bir sonraki kaynagi dene. Elimizdeki
        // en iyi cevabi yine de sakla: hicbiri yeterli degilse bos donmektense
        // eksik olani gostermek daha iyidir.
        if (accept && !accept(result)) {
          if (!hasRejected) {
            rejected = result;
            hasRejected = true;
          }
          if (onFailover) {
            onFailover({
              provider: String(provider.name || ""),
              code: "yetersiz-sonuc",
              message: "aranan veri yok, sonraki kaynak denenecek",
            });
          }
          continue;
        }

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

    // Hicbir kaynak aranani veremediyse elimizdeki en iyi cevabi doneriz;
    // eksik veri, hic veri olmamasindan iyidir.
    if (hasRejected) {
      return rejected;
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

  /**
   * `getRecentMatches`'in, sonucu dogrulayan surumu.
   *
   * Yeni biten bir mac aranirken kullanilir: OpenDota onu henuz almadiysa
   * hata vermeden eksik doner, bu yuzden Stratz denenmeli.
   *
   * @param {string} playerId
   * @param {{ limit?: number, expectMatchId?: string }} [options]
   */
  client.getRecentMatchesExpecting = (playerId, options = {}) => {
    const wanted = String(options.expectMatchId || "");
    return callChained(
      "getRecentMatches",
      [playerId, { limit: options.limit }],
      wanted
        ? {
            accept: (rows) =>
              Array.isArray(rows) &&
              rows.some((row) => String(row?.matchId) === wanted),
          }
        : {},
    );
  };

  /**
   * TUM kaynaklara sorar ve EN TAZE mac listesini doner.
   *
   * NEDEN GEREKLI: elle "Yenile"de hangi macin aranacagi bilinmez, dolayisiyla
   * `getRecentMatchesExpecting` kullanilamaz. Zincir sirasi korunursa OpenDota
   * "basarili ama eski" cevap verir ve yeni mac hic gorunmez — olculdu, bir
   * mac OpenDota'da 29 saat sonra bile yoktu, Stratz'ta dakikalar icinde vardi.
   *
   * Yalnizca ACIK tazelemede cagrilir; normal acilis tek kaynakla yetinir.
   *
   * @param {string} playerId
   * @param {{ limit?: number }} [options]
   */
  client.getRecentMatchesFreshest = async (playerId, options = {}) => {
    const usable = chain.filter(
      (provider) =>
        provider.isConfigured !== false &&
        typeof provider.getRecentMatches === "function",
    );

    const results = await Promise.all(
      usable.map(async (provider) => {
        try {
          const rows = await provider.getRecentMatches(playerId, {
            limit: options.limit,
          });
          return { provider, rows: Array.isArray(rows) ? rows : [] };
        } catch (error) {
          failures.push({
            provider: String(provider.name || ""),
            code: String(/** @type {any} */ (error)?.code || "unknown"),
            message: String(/** @type {any} */ (error)?.message || error),
          });
          return null;
        }
      }),
    );

    /** En yeni macin bitis zamani. */
    const newestAt = (rows) =>
      rows.reduce((top, row) => {
        const at = new Date(row?.startedAt || 0).getTime();
        return Number.isFinite(at) && at > top ? at : top;
      }, 0);

    const best = results
      .filter((row) => row && row.rows.length)
      .sort((a, b) => newestAt(b.rows) - newestAt(a.rows))[0];

    if (!best) {
      throw new Error("provider-chain: hicbir kaynak mac veremedi");
    }

    lastUsedProvider = String(best.provider.name || "");
    return best.rows;
  };

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
