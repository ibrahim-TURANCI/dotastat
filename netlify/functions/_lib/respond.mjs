/**
 * Fonksiyonlar icin ortak yanit yardimcilari.
 *
 * Tum uclar ayni zarfi kullanir:
 *   basarili -> { ok: true, ...veri }
 *   hatali   -> { ok: false, error: "kisa-kod", message: "aciklama" }
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

/**
 * @param {Record<string, unknown>} payload
 * @param {{ status?: number, headers?: Record<string, string>, cacheSeconds?: number }} [options]
 * @returns {Response}
 */
export function json(payload, options = {}) {
  const headers = { ...JSON_HEADERS, ...(options.headers || {}) };
  if (options.cacheSeconds) {
    // Tarayici tazeyi hemen alsin, CDN kisa sure onbellekte tutsun.
    headers["cache-control"] =
      "public, max-age=0, s-maxage=" + Number(options.cacheSeconds);
  }
  return new Response(JSON.stringify(payload), {
    status: options.status || 200,
    headers,
  });
}

/**
 * @param {string} error kisa hata kodu (`oyuncu-bulunamadi` gibi)
 * @param {{ status?: number, message?: string }} [options]
 * @returns {Response}
 */
export function fail(error, options = {}) {
  return json(
    { ok: false, error, message: options.message || "" },
    // `headers` 429 yanitinda `retry-after` gonderebilmek icin gecirilir.
    { status: options.status || 400, headers: options.headers },
  );
}

/**
 * @param {string} location
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
export function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: { location, ...headers },
  });
}

/**
 * Istegin geldigi site kokunu bulur (Netlify onunde proxy oldugu icin
 * `x-forwarded-*` basliklarina bakilir).
 * @param {Request} request
 * @returns {string}
 */
export function resolveOrigin(request) {
  const url = new URL(request.url);
  const proto = String(
    request.headers.get("x-forwarded-proto") || url.protocol.replace(":", ""),
  ).split(",")[0];
  const host = String(
    request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      url.host,
  );
  return proto + "://" + host;
}
