/**
 * Kisi basina istek siniri.
 *
 * NEDEN VAR: "Yenile" butonu her basildiginda OpenDota'ya gercek istek
 * gidiyor ve gunluk kota TUM ziyaretciler arasinda PAYLASILIYOR. Bir kisinin
 * butona dakikalarca basmasi herkesin verisini bozabilir.
 *
 * Sayac kayan pencere degil, basit zaman damgasi listesidir: pencere icindeki
 * damgalar tutulur, disari dusenler atilir. Kucuk olcekte (arkadas grubu) bu
 * yeterli ve okumasi kolay.
 *
 * Kimlik once oturumdan alinir; giris yapmamis ziyaretcilerde IP'ye dusulur.
 * IP paylasan iki kisi ayni kovaya girer — bu kasitlidir, kotayi koruyan sey
 * kisi degil istek sayisidir.
 */

import { presenceStore } from "./store.mjs";
import { readSession } from "./session.mjs";

/** Varsayilan: saatte 5 tazeleme. */
export const REFRESH_LIMIT = 5;
export const REFRESH_WINDOW_MS = 60 * 60 * 1000;

/**
 * Istegi gonderen kisiyi tanimlar.
 *
 * @param {Request} request
 * @returns {string}
 */
export function requesterKey(request) {
  const session = readSession(request);
  if (session?.steamId) {
    return "steam:" + session.steamId;
  }
  // Netlify gercek istemci IP'sini bu baslikta iletir.
  const forwarded = String(
    request.headers.get("x-nf-client-connection-ip") || "",
  ).trim();
  const fallback = String(request.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  return "ip:" + (forwarded || fallback || "bilinmiyor");
}

/**
 * Bir tazeleme hakkini tuketmeye calisir.
 *
 * @param {string} key `requesterKey` ciktisi
 * @param {{ limit?: number, windowMs?: number, action?: string }} [options]
 * @returns {Promise<{ ok: boolean, remaining: number, retryAfterSeconds: number }>}
 */
export async function consumeRefresh(key, options = {}) {
  const limit = Number(options.limit) || REFRESH_LIMIT;
  const windowMs = Number(options.windowMs) || REFRESH_WINDOW_MS;
  const action = String(options.action || "refresh");
  const storeKey = "ratelimit:" + action + ":" + key;

  // Presence kovasi kullaniliyor: kisa omurlu, kisiye bagli kayitlar zaten
  // orada duruyor ve ayni TTL mantigini paylasiyorlar.
  const store = presenceStore();
  const now = Date.now();

  const row = await store.get(storeKey);
  const previous = Array.isArray(row?.hits) ? row.hits : [];
  const hits = previous.filter((at) => now - Number(at) < windowMs);

  if (hits.length >= limit) {
    const oldest = Math.min(...hits);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowMs - (now - oldest)) / 1000),
    );
    return { ok: false, remaining: 0, retryAfterSeconds };
  }

  hits.push(now);
  await store.set(storeKey, { hits }, { ttlMs: windowMs });

  return {
    ok: true,
    remaining: Math.max(0, limit - hits.length),
    retryAfterSeconds: 0,
  };
}

/**
 * Sinir asildiginda dondurulecek yanit govdesi.
 *
 * @param {number} retryAfterSeconds
 * @returns {{ error: string, message: string }}
 */
export function limitMessage(retryAfterSeconds) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return {
    error: "cok-fazla-yenileme",
    message:
      "Saatte en fazla " +
      REFRESH_LIMIT +
      " kez yenileyebilirsin. " +
      (minutes > 1 ? minutes + " dakika" : "Birazdan") +
      " sonra tekrar dene. (Veri kaynağının günlük kotası paylaşılıyor.)",
  };
}
