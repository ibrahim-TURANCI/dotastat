/**
 * Masaustu uygulamasini kullanan kisiyi sitedeki online listesine ekler ve
 * listeyi geri alir.
 *
 * Neden gerekli: online listesi eskiden yalnizca siteyi acik tutanlari
 * goruyordu; uygulamayi acip oyuna giren arkadas listede yoktu. Masaustunde
 * de liste yalnizca "bu bilgisayar"dan ibaretti.
 *
 * Kurallar:
 *   - Dakikada bir heartbeat (sitedeki 3 dakikalik omrun altinda, bkz.
 *     netlify/functions/_lib/presence.mjs PRESENCE_TTL_MS). Yanit online
 *     listesini tasir; liste icin ayrica istek atilmaz.
 *   - Oyuna girip cikinca ya da mac degisince beklemeden bir heartbeat gider.
 *   - Kimlik cihaz anahtariyla gider (bkz. cloud-session.js); SteamID henuz
 *     bilinmiyorsa (oyun hic acilmadi) istek atilmaz.
 *   - Uygulama kapanirken tek bir "ayrildim" istegi.
 *   - Hata sessizce gecilir.
 */

const { canAuthenticate, cloudFetch } = require("./cloud-session.js");

/** Iki heartbeat arasindaki sure. */
const BEAT_MS = 60 * 1000;
/** Oyun durumu bu siklikla kontrol edilir (yerel, istek atmaz). */
const CHECK_MS = 5 * 1000;
/** Bu kadar eski liste kullanilmaz (heartbeat'ler basarisiz oluyorsa). */
const MAX_LIST_AGE_MS = 3 * 60 * 1000;

/**
 * @param {Object} options
 * @param {() => { cloudUrl: string, steamId: string }} options.getConfig
 * @param {() => { inGame: boolean, hero: string, matchId?: string }} options.getStatus
 * @param {{ warn?: Function }} [options.logger]
 */
function createCloudPresence(options) {
  const logger = options.logger || console;

  let timer = null;
  let busy = false;
  let lastBeatAt = 0;
  let lastInGame = null;
  let lastMatchId = "";
  let lastError = "";
  /** @type {{ at: number, online: Array<Record<string, any>> }|null} */
  let list = null;

  /** @returns {string} sitenin kok adresi; yapilandirilmamissa bos */
  function base() {
    return String(options.getConfig().cloudUrl || "")
      .trim()
      .replace(/\/+$/, "");
  }

  async function beat() {
    const url = base();
    if (busy || !url || !options.getConfig().steamId) {
      return;
    }
    if (!(await canAuthenticate(url))) {
      return;
    }
    busy = true;
    const status = options.getStatus();
    try {
      const response = await cloudFetch(url + "/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client: "desktop",
          inGame: Boolean(status.inGame),
          hero: String(status.hero || ""),
          matchId: String(status.matchId || ""),
        }),
      });
      if (!response.ok) {
        throw new Error("http-" + response.status);
      }
      const payload = await response.json();
      if (Array.isArray(payload?.online)) {
        list = { at: Date.now(), online: payload.online };
      }
      lastBeatAt = Date.now();
      lastInGame = Boolean(status.inGame);
      lastMatchId = String(status.matchId || "");
      lastError = "";
    } catch (error) {
      const message = String(error?.message || error);
      if (message !== lastError) {
        logger.warn?.("Online bildirimi gonderilemedi", message);
      }
      lastError = message;
      // Hata durumunda da sayaci ilerlet: site erisilemezken her 5 sn'de
      // yeniden denenmesin.
      lastBeatAt = Date.now();
    } finally {
      busy = false;
    }
  }

  function tick() {
    const status = options.getStatus();
    const inGame = Boolean(status.inGame);
    // Yeni maca girildiginde de beklenmez: pick oncesi draft asistani online
    // arkadaslari mac kimligine gore ayikliyor (bkz. core match-context).
    if (
      Date.now() - lastBeatAt >= BEAT_MS ||
      (lastInGame !== null && inGame !== lastInGame) ||
      (lastInGame !== null && String(status.matchId || "") !== lastMatchId)
    ) {
      beat();
    }
  }

  return {
    start() {
      if (!timer) {
        timer = setInterval(tick, CHECK_MS);
        timer.unref?.();
        beat();
      }
    },

    /** Uygulama kapanirken: listeden aninda cik. */
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const url = base();
      // Hic basarili heartbeat gitmediyse listede degiliz.
      if (!url || lastInGame === null) {
        return;
      }
      try {
        await cloudFetch(url + "/api/presence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client: "desktop", leave: true }),
          timeoutMs: 2000,
        });
      } catch {
        // Gitmezse kayit sitede kendiliginden duser.
      }
    },

    /**
     * Sitedeki online listesi; henuz alinmadiysa ya da eskidiyse `null`.
     * @returns {Array<Record<string, any>>|null}
     */
    online() {
      if (!list || Date.now() - list.at > MAX_LIST_AGE_MS) {
        return null;
      }
      return list.online;
    },

    /** Debug paneli icin. */
    status: () => ({
      at: lastBeatAt ? new Date(lastBeatAt).toISOString() : "",
      count: list?.online?.length ?? null,
      error: lastError,
    }),
  };
}

module.exports = {
  createCloudPresence,
};
