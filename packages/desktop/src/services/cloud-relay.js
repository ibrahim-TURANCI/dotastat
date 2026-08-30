/**
 * Canli mac verisini buluta (Netlify sitesine) iletir.
 *
 * Neden gerekli: GSI verisi yalnizca oyunun kurulu oldugu bilgisayara gelir.
 * Arkadaslarin siteden canli maci gorebilmesi icin bu veri tek bir yerde
 * toplanmali. Rolenin tek isi budur.
 *
 * Gonderim kurallari:
 *   - Ayni durum tekrar tekrar gonderilmez (imza karsilastirmasi).
 *   - En fazla `minIntervalMs` de bir istek atilir.
 *   - Hata durumunda sessizce gecilir; oyun ici deneyim etkilenmez.
 */

const { readSessionCookie } = require("./cloud-session.js");

/** Iki gonderim arasindaki en kisa sure. */
const MIN_INTERVAL_MS = 2500;

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
  function signatureOf(state) {
    return [
      state?.matchId,
      state?.phase,
      state?.radiantScore,
      state?.direScore,
      Math.floor(Number(state?.gameTime || 0) / 5),
      (state?.draft?.picks || [])
        .map((row) => row.team + ":" + row.hero)
        .join(","),
      (state?.draft?.bans || []).map((row) => row.hero).join(","),
      [...(state?.radiantPlayers || []), ...(state?.direPlayers || [])]
        .map(
          (row) =>
            row.steamId + ":" + row.hero + ":" + row.kills + ":" + row.deaths,
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
    //   - Steam oturumu (tercih edilen): kullanici uygulamadan siteye giris
    //     yapmis, cerez Electron oturumunda duruyor.
    //   - Paylasilan token (eski yol): ayarlardan elle girilmis.
    const cookie = await readSessionCookie(config.cloudUrl);
    if (
      !config.shareLive ||
      !config.cloudUrl ||
      !(cookie || config.ingestToken)
    ) {
      lastResult = {
        ok: false,
        at: new Date().toISOString(),
        error: cookie || config.ingestToken ? "yapilandirilmadi" : "giris-yok",
      };
      return;
    }

    const endpoint = config.cloudUrl.replace(/\/+$/, "") + "/api/live";
    const headers = { "content-type": "application/json" };
    if (cookie) {
      headers.cookie = cookie;
    } else {
      headers["x-dotastat-token"] = config.ingestToken;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          state,
          uploaderSteamId: config.steamId || state?.localSteamId || "",
        }),
        signal: AbortSignal.timeout(6000),
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

      const signature = signatureOf(state);
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      pending = state;

      const wait = Math.max(0, minIntervalMs - (Date.now() - lastSentAt));
      if (timer) {
        return;
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
