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
   * `fresh`: CDN'deki kopyayi atlar (kaynaga GITMEZ, yalnizca ortak onbellek
   * okunur). Detayda "Yenile"den hemen sonra kullanilir; aksi halde liste
   * CDN'in 60 saniyelik eski kopyasini gosterip yeni maclari gizliyordu.
   *
   * @param {{ refresh?: boolean, period?: string, fresh?: boolean }} [options]
   */
  players: (options = {}) => {
    const params = new URLSearchParams();
    if (options.refresh) {
      params.set("refresh", "1");
    }
    if (options.fresh) {
      // Her cagri ayri adres: CDN onbellek anahtari sorgu dizesini kapsar.
      params.set("fresh", String(Date.now()));
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
   * Yanit online listesini de tasir; giris yapmis kullanicinin yoklamasi
   * sunucuda "buradayim" sayilir. `hello`: sayfanin ilk istegi — kullanici
   * listede hemen gorunsun (sunucudaki yazma kisitlamasi atlanir).
   *
   * @param {string} [steamId]
   * @param {{ freshPlans?: boolean, hello?: boolean }} [options]
   */
  live: (steamId = "", options = {}) => {
    const params = new URLSearchParams();
    if (steamId) {
      params.set("steamId", steamId);
    }
    if (options?.freshPlans) {
      params.set("plans", "fresh");
    }
    if (options?.hello) {
      params.set("hello", "1");
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

  /**
   * Gecerli duzenlemeleri VARSAYILAN olarak kaydeder (yalnizca katalog
   * yoneticisi). Tavsiye degismez; "duzenlenmis" isaretleri sifirlanir.
   */
  saveHeroDefaults: () =>
    request("/api/me/hero-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save-defaults" }),
    }),

  /** Online listesi (masaustunde; sitede liste `live` yanitindan gelir). */
  presence: () => request("/api/presence"),

  /** Online kalmak icin heartbeat (yalnizca sekme arka plandayken). */
  heartbeat: (body = {}) =>
    request("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  /**
   * Sekme kapanirken online listesinden cik. `sendBeacon` sayfa kapanirken
   * de teslim edilir; desteklenmiyorsa `keepalive` ile denenir.
   */
  leavePresence: () => {
    const body = JSON.stringify({ leave: true });
    try {
      if (
        navigator.sendBeacon?.(
          "/api/presence",
          new Blob([body], { type: "application/json" }),
        )
      ) {
        return;
      }
    } catch {
      // Asagidaki yola dus.
    }
    fetch("/api/presence", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {});
  },

  /** Masaustu kurulum dosyasi bilgisi. */
  release: () => request("/api/release"),

  /** Debug paneli verisi. */
  debug: () => request("/api/debug"),

  /**
   * Kadro islemi (Debug paneli -> Onbellek tablosu). Yalnizca katalog
   * yoneticisi; sunucu ayrica kontrol eder.
   *
   *   { action: "add", accountId, name? }
   *   { action: "edit", id, name?, accountId? }
   *   { action: "hide" | "show" | "delete", id }
   *
   * @param {Record<string, string>} change
   */
  rosterChange: (change) =>
    request("/api/roster", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    }),

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

/**
 * Kadro degisince (Debug paneli) yayinlanan pencere olayi; Oyuncu
 * Degerlendirme ekrani listeyi CDN kopyasini atlayarak tazeler.
 */
export const ROSTER_CHANGED_EVENT = "dotastat:roster-changed";

/** Steam girisi ayni sekmede baslatilir (OpenID yonlendirmesi). */
export function startSteamLogin() {
  window.location.href = "/api/auth/login";
}
