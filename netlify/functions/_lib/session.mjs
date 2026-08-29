/**
 * Steam oturumu (imzali cerez).
 *
 * Sunucu tarafinda oturum saklamiyoruz: SteamID64 + son kullanma tarihi
 * cerezin icine yazilip HMAC-SHA256 ile imzalaniyor. Imza dogrulanmadan
 * hicbir deger kullanilmaz, dolayisiyla cerez elle degistirilemez.
 */

import crypto from "node:crypto";

const COOKIE_NAME = "dotastat_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @returns {string}
 */
function secret() {
  const value = String(process.env.SESSION_SECRET || "").trim();
  if (value) {
    return value;
  }
  // Ortam degiskeni yoksa site kimligine bagli bir yedek uretilir; boylece
  // gelistirme sirasinda da calisir ama production'da SESSION_SECRET sart.
  return "dotastat-dev-" + String(process.env.SITE_ID || "local");
}

/**
 * Cerez https disinda da tutunabilsin diye `Secure` kosullu eklenir.
 * Production (Netlify) her zaman https oldugu icin varsayilan acik kalir.
 * @param {{ secure?: boolean }} options
 * @returns {string}
 */
function secureFlag(options) {
  return options.secure === false ? "" : " Secure;";
}

/**
 * @param {string} payload
 * @returns {string}
 */
function sign(payload) {
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

/**
 * @param {{ steamId: string, name?: string, avatar?: string, accountId?: string }} session
 * @param {{ secure?: boolean }} [options] `secure: false` yalnizca yerel
 *   gelistirme icindir; tarayici `Secure` cerezi duz http uzerinde reddeder.
 * @returns {string} Set-Cookie basligi degeri
 */
export function buildSessionCookie(session, options = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      steamId: String(session.steamId || ""),
      name: String(session.name || ""),
      avatar: String(session.avatar || ""),
      accountId: String(session.accountId || ""),
      expiresAt: Date.now() + SESSION_TTL_MS,
    }),
    "utf8",
  ).toString("base64url");

  const token = payload + "." + sign(payload);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return (
    COOKIE_NAME +
    "=" +
    token +
    "; Path=/; HttpOnly;" +
    secureFlag(options) +
    " SameSite=Lax; Max-Age=" +
    maxAge
  );
}

/**
 * @param {{ secure?: boolean }} [options]
 * @returns {string} oturumu silen Set-Cookie basligi
 */
export function buildLogoutCookie(options = {}) {
  return (
    COOKIE_NAME +
    "=; Path=/; HttpOnly;" +
    secureFlag(options) +
    " SameSite=Lax; Max-Age=0"
  );
}

/**
 * @param {Request} request
 * @returns {{ steamId: string, name: string, avatar: string, accountId: string }|null}
 */
export function readSession(request) {
  const header = request.headers.get("cookie") || "";
  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(COOKIE_NAME + "="));
  if (!match) {
    return null;
  }

  const token = match.slice(COOKIE_NAME.length + 1);
  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.steamId || Date.now() > Number(data.expiresAt || 0)) {
      return null;
    }
    return {
      steamId: String(data.steamId),
      name: String(data.name || ""),
      avatar: String(data.avatar || ""),
      accountId: String(data.accountId || ""),
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME, SESSION_TTL_MS };
