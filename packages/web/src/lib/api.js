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
  /**
   * Oyuncu kartlari.
   *
   * `period` ("week" | "month") her karta o donemin ozetini ekler (puan, G/M,
   * MMR degisimi, Performance Rank, mac sayisi) ve kartlari puana gore siralar.
   *
   * @param {{ refresh?: boolean, period?: string }} [options]
   */
  players: (options = {}) => {
    const params = new URLSearchParams();
    if (options.refresh) {
      params.set("refresh", "1");
    }
    if (options.period) {
      params.set("period", options.period);
    }
    const query = params.toString();
    return request("/api/players" + (query ? "?" + query : ""));
  },

  /** Tek oyuncunun detayi. */
  player: (playerKey, options = {}) =>
    request(
      "/api/players/" +
        encodeURIComponent(playerKey) +
        (options.refresh ? "?refresh=1" : ""),
    ),

  /**
   * Tek macin tam kadrosu (iki takim, on oyuncu, herkes icin PR).
   * Sunucu maci bir kez ceker ve kalici onbellege yazar.
   * @param {string} matchId
   */
  match: (matchId) => request("/api/matches/" + encodeURIComponent(matchId)),

  /**
   * Canli mac durumu (GSI).
   *
   * `freshPlans`: sunucu, hero tavsiyesi duzenlemelerini 60 saniye hafizada
   * tutuyor (her yoklamada depoya gitmemek icin). Kullanici az once kaydettiyse
   * o hafiza atlanmali, yoksa degisiklik bir dakika gorunmezdi.
   *
   * @param {string} [steamId]
   * @param {{ freshPlans?: boolean }} [options]
   */
  live: (steamId = "", options = {}) => {
    const params = new URLSearchParams();
    if (steamId) {
      params.set("steamId", steamId);
    }
    if (options?.freshPlans) {
      params.set("plans", "fresh");
    }
    const query = params.toString();
    return request("/api/live" + (query ? "?" + query : ""));
  },

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

  /**
   * Kullanicinin hero basina elle duzenledigi tavsiye kayitlari.
   *
   * Yalnizca DUZENLENMIS heroler doner; tohum veri arayuz paketinde zaten var
   * (bkz. @dotastat/core -> heroCatalog). 127 hero'luk tabloyu her dialog
   * acilisinda ag uzerinden tasimanin anlami yok.
   */
  heroPlans: () => request("/api/me/hero-plans"),

  /**
   * Bir hero'nun duzenlemesini kaydeder.
   *
   * Yalnizca GONDERILEN alanlar yazilir; hicbir alan gonderilmezse kayit
   * silinir ve hero tohum veriye doner ("Sifirla").
   *
   * @param {string} hero
   * @param {Record<string, any>} patch
   */
  setHeroPlan: (hero, patch) =>
    request("/api/me/hero-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hero, ...(patch || {}) }),
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

  /**
   * Masaustu ayarlari. Yalnizca masaustu sunucusunda vardir; sitede bu uc
   * bulunmaz, bu yuzden arayuz onu sadece `mode === "desktop"` iken cagirir.
   */
  settings: () => request("/api/settings"),

  /**
   * @param {Record<string, unknown>} patch Yalnizca degisen alanlar
   */
  saveSettings: (patch) =>
    request("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
};

/** Steam girisi ayni sekmede baslatilir (OpenID yonlendirmesi). */
export function startSteamLogin() {
  window.location.href = "/api/auth/login";
}
