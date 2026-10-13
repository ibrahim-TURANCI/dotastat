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
 *
 * METOT BAZLI SIRA (`options.order`): her uc icin ayri oncelik verilebilir
 * (ornek: mac listesi Stratz -> OpenDota, profil OpenDota -> Stratz). Sirada
 * adi gecmeyen saglayicilar listenin sonuna, verilis sirasiyla eklenir.
 */

import {
  providerError,
  RATE_LIMIT,
  shouldFailover,
  UNAVAILABLE,
} from "./provider-errors.js";

/** Zincirin destekledigi metotlar. Hepsi ayni imzayi tasir. */
const CHAINED_METHODS = [
  "getPlayerProfile",
  "getRecentMatches",
  "getPlayerStats",
  "getHeroPerformance",
  // Tek macin tam kadrosu (OpenDota ve Stratz).
  "getMatchDetail",
];

/**
 * @param {Array<Record<string, any>>} providers Varsayilan oncelik sirasiyla
 * @param {{
 *   onFailover?: (info: { provider: string, code: string, message: string }) => void,
 *   order?: Record<string, string[]>
 * }} [options] `order`: metot adi -> saglayici adlari (oncelik sirasiyla)
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

  const order =
    options.order && typeof options.order === "object" ? options.order : {};

  /**
   * Metodun saglayici sirasi: `order[method]` once, kalanlar varsayilan
   * sirayla arkasina.
   * @param {string} method
   */
  function chainFor(method) {
    const names = Array.isArray(order[method]) ? order[method] : [];
    if (!names.length) {
      return chain;
    }
    const rank = (provider) => {
      const index = names.indexOf(String(provider.name || ""));
      return index === -1 ? names.length : index;
    };
    return chain
      .map((provider, index) => ({ provider, index }))
      .sort((a, b) => rank(a.provider) - rank(b.provider) || a.index - b.index)
      .map((row) => row.provider);
  }

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

    for (const provider of chainFor(method)) {
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
    const usable = chainFor("getRecentMatches").filter(
      (provider) =>
        provider.isConfigured !== false &&
        typeof provider.getRecentMatches === "function",
    );

    // ISTEK TASARRUFU: kaynaklar SIRAYLA sorulur; birincil kaynak mac
    // donerse digerine gidilmez. Eskiden tazelemede iki kaynaga AYNI ANDA
    // gidiliyordu (oyuncu basina 2 istek). Birincil kaynak Stratz yeni maci
    // dakikalar icinde gordugu icin ikinci istek cogu zaman bosa gidiyordu.
    // Birincil hata verir ya da bos donerse siradaki denenir.
    /** @type {Array<{ provider: Record<string, any>, rows: Array<Record<string, any>> }|null>} */
    const results = [];
    for (const provider of usable) {
      try {
        const rows = await provider.getRecentMatches(playerId, {
          limit: options.limit,
        });
        results.push({ provider, rows: Array.isArray(rows) ? rows : [] });
        if (Array.isArray(rows) && rows.length) {
          break;
        }
      } catch (error) {
        failures.push({
          provider: String(provider.name || ""),
          code: String(/** @type {any} */ (error)?.code || "unknown"),
          message: String(/** @type {any} */ (error)?.message || error),
        });
        results.push(null);
        // Kalici hatada (oyuncu yok) sonraki kaynagi denemenin anlami yok.
        if (!shouldFailover(error)) {
          break;
        }
      }
    }

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
      // Hata kaynak bazinda yazilir ("opendota:rate-limit"): arayuz "Yenile"
      // neden bir sey getirmedigini bundan soyler. Genel bir mesaj, cevap
      // veren ama mac donmeyen kaynakla erisilemeyen kaynagi ayirt etmiyordu.
      const reasons = results.map((row, index) =>
        row
          ? String(usable[index].name || "") + ":bos"
          : String(usable[index].name || "") +
            ":" +
            String(
              failures.findLast(
                (failure) => failure.provider === usable[index].name,
              )?.code || "unknown",
            ),
      );
      const allLimited =
        reasons.length > 0 &&
        reasons.every((reason) => reason.endsWith(":" + RATE_LIMIT));
      throw providerError(
        "kaynak-yok " + reasons.join(" "),
        allLimited ? RATE_LIMIT : UNAVAILABLE,
        "chain",
      );
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

  // Tarama istegi (OpenDota'ya "bu oyuncunun maclarini Steam'den cek")
  // yalnizca mac listesinin BIRINCIL kaynagina gonderilir ve sonuc beklenmez.
  // Birincil kaynak Stratz ise (tarama ucu yok) istek atilmaz: OpenDota'yi
  // taramak, verisini kullanmayacagimiz bir kaynaga istek harcamak olurdu.
  client.requestRefresh = async (...args) => {
    const primary = chainFor("getRecentMatches").find(
      (provider) =>
        provider.isConfigured !== false &&
        typeof provider.getRecentMatches === "function",
    );
    if (primary && typeof primary.requestRefresh === "function") {
      await primary.requestRefresh(...args).catch(() => false);
    }
  };

  return client;
}
