/**
 * Canli mac verisini buluta (Netlify sitesine) iletir.
 *
 * Neden gerekli: GSI verisi yalnizca oyunun kurulu oldugu bilgisayara gelir.
 * Arkadaslarin siteden canli maci gorebilmesi icin bu veri tek bir yerde
 * toplanmali. Rolenin tek isi budur.
 *
 * Gonderim kurallari (her gonderim Netlify'da ayri bir istek):
 *   - Ayni durum tekrar tekrar gonderilmez (imza karsilastirmasi).
 *   - DRAFT ve oyunun ILK DAKIKALARI: tavsiyeler o an olusuyor; 5 sn'lik saat
 *     dilimi imzaya girer, en fazla `minIntervalMs` de bir gonderilir.
 *   - SONRASI: yalnizca anlamli degisiklikte (skor, KDA, item, seviye,
 *     buyuk net worth farki), en fazla LATE_INTERVAL_MS de bir. Hicbir sey
 *     degismese de KEEPALIVE_MS de bir gonderilir; aksi halde site maci 3
 *     dakika sonra "bitti" sayardi (bkz. core LIVE_MATCH_TTL_MS).
 *   - Mac BITTIGINDE (POST_GAME) bekleme yapilmadan hemen gonderilir; site
 *     kaydi siler ve panel kapanir.
 *   - Hata durumunda sessizce gecilir; oyun ici deneyim etkilenmez.
 */

const { canAuthenticate, cloudFetch } = require("./cloud-session.js");

/** Draft ve erken oyunda iki gonderim arasindaki en kisa sure. */
const MIN_INTERVAL_MS = 2500;
/** Erken oyundan sonra iki gonderim arasindaki en kisa sure. */
const LATE_INTERVAL_MS = 10000;
/** Degisiklik olmasa da bu sureden seyrek gonderilmez (sitedeki 3 dk omur). */
const KEEPALIVE_MS = 60000;
/** Oyun saatine gore "erken oyun" siniri (saniye). */
const EARLY_GAME_SECONDS = 5 * 60;

/** Bu asamalarda tavsiyeler sik guncellenmeli. */
const DRAFT_PHASES = [
  "HERO_SELECTION",
  "STRATEGY_TIME",
  "PRE_GAME",
  "TEAM_SHOWCASE",
];
/** Bu asamalar mac sonunu bildirir; hemen gonderilir. */
const ENDED_PHASES = ["POST_GAME", "DISCONNECT"];

/**
 * @param {Record<string, any>} state
 * `idle`: ana menu (mac kimligi yok). `ended` ve `idle` icin keepalive
 * gonderilmez; mac yokken siteye istek gitmez.
 *
 * @returns {"idle"|"draft"|"early"|"late"|"ended"}
 */
function stageOf(state) {
  const phase = String(state?.phase || "").toUpperCase();
  if (ENDED_PHASES.some((name) => phase.includes(name))) {
    return "ended";
  }
  if (!String(state?.matchId || "").trim()) {
    return "idle";
  }
  if (DRAFT_PHASES.some((name) => phase.includes(name))) {
    return "draft";
  }
  return Number(state?.gameTime || 0) < EARLY_GAME_SECONDS ? "early" : "late";
}

/**
 * @param {Object} options
 * @param {() => { cloudUrl: string, ingestToken: string, shareLive: boolean, steamId: string }} options.getConfig
 * @param {{ info: Function, warn: Function }} [options.logger]
 */
function createCloudRelay(options) {
  const getConfig = options.getConfig;
  const logger = options.logger || console;
  const minIntervalMs = Number(options.minIntervalMs) || MIN_INTERVAL_MS;

  let lastSentAt = 0;
  let lastSignature = "";
  let pending = null;
  let timer = null;
  let lastResult = { ok: false, at: "", error: "kapali" };

  /**
   * Durumun "degisti mi" imzasi. Sadece ekranda gorunen alanlara bakilir;
   * boylece her kucuk oynamada istek atilmaz.
   * @param {Record<string, any>} state
   * @returns {string}
   */
  function signatureOf(state, stage) {
    const frequent = stage === "draft" || stage === "early";
    return [
      state?.matchId,
      state?.phase,
      state?.radiantScore,
      state?.direScore,
      // Erken asamada saat dilimi imzaya girer: tavsiyeler ve draft durumu
      // her 5 saniyede tazelenir. Sonrasinda yalnizca asagidaki degisiklikler.
      frequent ? Math.floor(Number(state?.gameTime || 0) / 5) : "",
      (state?.draft?.picks || [])
        .map((row) => row.team + ":" + row.hero)
        .join(","),
      (state?.draft?.bans || []).map((row) => row.hero).join(","),
      [...(state?.radiantPlayers || []), ...(state?.direPlayers || [])]
        .map((row) =>
          [
            row.steamId,
            row.hero,
            row.kills,
            row.deaths,
            row.assists,
            row.level,
            (row.items || []).join("+"),
            row.neutral,
            // Tehdit analizi net worth'e bakiyor; kucuk oynamalar degil,
            // 1000 altinlik farklar gonderim sebebi.
            Math.floor(Number(row.netWorth || 0) / 1000),
          ].join(":"),
        )
        .join(","),
    ].join("|");
  }

  /**
   * @param {Record<string, any>} state
   */
  async function send(state) {
    const config = getConfig();

    // Yetkilendirme icin iki yol var; en az biri hazir olmali.
    //   - Cihaz kimligi ya da Steam oturumu (bkz. cloud-session.js): giris
    //     gerekmez, SteamID oyundan tespit edilir.
    //   - Paylasilan token (eski yol): ayarlardan elle girilmis.
    const signedIn = await canAuthenticate(config.cloudUrl);
    if (
      !config.shareLive ||
      !config.cloudUrl ||
      !(signedIn || config.ingestToken)
    ) {
      lastResult = {
        ok: false,
        at: new Date().toISOString(),
        error:
          signedIn || config.ingestToken ? "yapilandirilmadi" : "giris-yok",
      };
      return;
    }

    const endpoint = config.cloudUrl.replace(/\/+$/, "") + "/api/live";
    // Cerez ELLE eklenmez: Electron ana surecinde `cookie` yasakli bir
    // basliktir ve sessizce dusurulur — istek kimliksiz gider. `cloudFetch`
    // cerezi oturumdan kendisi ekler. Giris yoksa eski token yoluna dusulur.
    const headers = { "content-type": "application/json" };
    if (!signedIn) {
      headers["x-dotastat-token"] = config.ingestToken;
    }

    try {
      const response = await cloudFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          state,
          uploaderSteamId: config.steamId || state?.localSteamId || "",
        }),
      });

      lastResult = response.ok
        ? { ok: true, at: new Date().toISOString(), error: "" }
        : {
            ok: false,
            at: new Date().toISOString(),
            error: "http-" + response.status,
          };

      if (!response.ok) {
        logger.warn?.("Canli mac yayini reddedildi", lastResult.error);
      }
    } catch (error) {
      lastResult = {
        ok: false,
        at: new Date().toISOString(),
        error: String(error?.message || error),
      };
    }
  }

  return {
    /**
     * Yeni durumu kuyruga koyar. Gercek gonderim hiz sinirina gore yapilir.
     * @param {Record<string, any>} state
     */
    push(state) {
      if (!state) {
        return;
      }

      const stage = stageOf(state);
      const signature = signatureOf(state, stage);
      const keepalive =
        stage !== "idle" &&
        stage !== "ended" &&
        lastSentAt > 0 &&
        Date.now() - lastSentAt >= KEEPALIVE_MS;
      if (signature === lastSignature && !keepalive) {
        return;
      }
      lastSignature = signature;
      pending = state;

      const gap =
        stage === "ended"
          ? 0
          : stage === "late"
            ? Math.max(minIntervalMs, LATE_INTERVAL_MS)
            : minIntervalMs;
      const wait = Math.max(0, gap - (Date.now() - lastSentAt));
      if (timer) {
        // Mac bitti: bekleyen gonderim beklemeden yapilsin.
        if (stage !== "ended" && stage !== "idle") {
          return;
        }
        clearTimeout(timer);
        timer = null;
      }

      timer = setTimeout(() => {
        timer = null;
        const payload = pending;
        pending = null;
        lastSentAt = Date.now();
        if (payload) {
          send(payload);
        }
      }, wait);
    },

    /** Son gonderim sonucu (debug panelinde gosterilir). */
    status: () => ({ ...lastResult }),

    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

module.exports = {
  createCloudRelay,
};
