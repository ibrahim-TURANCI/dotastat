/**
 * Backend istemcisi.
 *
 * Ayni arayuz iki farkli sunucuya baglanir:
 *   - Netlify Functions (canli site)
 *   - Electron icindeki yerel sunucu (3044)
 * Ikisi de ayni `/api/...` yollarini ve ayni yanit zarfini kullanir.
 */

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function request(path, init = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json", ...(init.headers || {}) },
    ...init,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const error = new Error(
      payload?.message ||
        payload?.error ||
        "istek-basarisiz-" + response.status,
    );
    error.code = payload?.error || String(response.status);
    throw error;
  }

  return payload;
}

export const api = {
  /** Oyuncu kartlari. */
  players: (options = {}) =>
    request("/api/players" + (options.refresh ? "?refresh=1" : "")),

  /** Tek oyuncunun detayi. */
  player: (playerKey, options = {}) =>
    request(
      "/api/players/" +
        encodeURIComponent(playerKey) +
        (options.refresh ? "?refresh=1" : ""),
    ),

  /** Canli mac durumu (GSI). */
  live: (steamId = "") =>
    request(
      "/api/live" + (steamId ? "?steamId=" + encodeURIComponent(steamId) : ""),
    ),

  /** Oturum bilgisi. */
  session: () => request("/api/auth/session"),

  /** Oturumu kapat. */
  logout: () => request("/api/auth/logout", { method: "POST" }),

  /** Kullanicinin kendi maclari icin sectigi pozisyonlar. */
  matchRoles: () => request("/api/me/match-roles"),

  /**
   * Bir macin pozisyonunu isaretler. `role` bos verilirse kayit silinir ve
   * degerlendirme yeniden saglayici tahminine doner.
   * @param {string} matchId
   * @param {string} role "pos1".."pos5" veya ""
   */
  setMatchRole: (matchId, role) =>
    request("/api/me/match-roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId, role }),
    }),

  /** Online listesi. */
  presence: () => request("/api/presence"),

  /** Online kalmak icin heartbeat. */
  heartbeat: (body = {}) =>
    request("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  /** Masaustu kurulum dosyasi bilgisi. */
  release: () => request("/api/release"),

  /** Debug paneli verisi. */
  debug: () => request("/api/debug"),
};

/** Steam girisi ayni sekmede baslatilir (OpenID yonlendirmesi). */
export function startSteamLogin() {
  window.location.href = "/api/auth/login";
}
