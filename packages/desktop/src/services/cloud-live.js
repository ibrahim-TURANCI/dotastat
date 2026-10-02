/**
 * Ayni maçtaki DIGER DotaStat kullanicilarinin verisini siteden ceker.
 *
 * Neden gerekli: GSI oyun sirasinda yalnizca bu bilgisayarin oyuncusunu
 * anlatir. Takim arkadasi da uygulamayi kullaniyorsa onun envanteri ve
 * KDA'si, Overwolf'u varsa 10 slotun hero ve pozisyon bilgisi zaten siteye
 * gidiyor. Bu servis onu geri alir; item tavsiyesi ve draft asistani
 * arkadasin gercek verisiyle calisir.
 *
 * Kurallar:
 *   - Yalnizca yerelde taze, mac kimligi olan bir mac varken istek atilir.
 *   - En fazla `intervalMs` de bir istek; hata sessizce gecilir.
 *   - Kendi kaydimiz sitede ayiklanir (`exclude`), yoksa eski kopyamiz
 *     yereldeki taze veriyi ezerdi.
 *   - Cekilen veri buluta GERI GONDERILMEZ (bkz. app.js `localLiveState`):
 *     aksi halde kayitlar birbirini dongu halinde besler.
 */

const { cloudFetch } = require("./cloud-session.js");

/** Iki cekim arasindaki sure. Site paneli de 5 sn'de bir yokluyor. */
const INTERVAL_MS = 5000;
/**
 * Macta baska yayinci YOKKEN iki cekim arasindaki sure. Cogu macta kadrodan
 * tek kisi var; ona her 5 sn'de bos cevap almak macta saatte ~720 gereksiz
 * istek demekti. Bir arkadas yayina katilinca en gec bu kadar sonra fark
 * edilir ve hiz yeniden INTERVAL_MS'e doner.
 */
const IDLE_INTERVAL_MS = 15000;
/** Bu kadar eski uzak veri kullanilmaz. */
const MAX_AGE_MS = 30 * 1000;

/**
 * @param {Object} options
 * @param {() => { cloudUrl: string, steamId: string }} options.getConfig
 * @param {() => Record<string, any>|null} options.getLocalState
 * @param {{ info?: Function, warn?: Function }} [options.logger]
 * @param {number} [options.intervalMs]
 */
function createCloudLiveWatcher(options) {
  const intervalMs = Number(options.intervalMs) || INTERVAL_MS;
  const logger = options.logger || console;

  /** @type {{ matchId: string, at: number, state: Record<string, any>|null }|null} */
  let latest = null;
  let timer = null;
  let busy = false;
  let lastError = "";
  /** Son cekimin zamani; baska yayinci yoksa seyrek cekilir. */
  let lastFetchAt = 0;

  async function tick() {
    if (busy) {
      return;
    }
    const local = options.getLocalState();
    const matchId = String(local?.matchId || "").trim();
    const { cloudUrl, steamId } = options.getConfig();
    if (!matchId || !cloudUrl) {
      latest = null;
      return;
    }
    const sameMatch = latest?.matchId === matchId;
    if (
      sameMatch &&
      !latest.state &&
      Date.now() - lastFetchAt < IDLE_INTERVAL_MS
    ) {
      return;
    }
    lastFetchAt = Date.now();

    busy = true;
    try {
      const query = new URLSearchParams({ raw: "1", matchId });
      if (steamId) {
        query.set("exclude", steamId);
      }
      const response = await cloudFetch(
        cloudUrl.replace(/\/+$/, "") + "/api/live?" + query.toString(),
        { method: "GET" },
      );
      if (!response.ok) {
        throw new Error("http-" + response.status);
      }
      const body = await response.json();
      latest = { matchId, at: Date.now(), state: body?.state || null };
      lastError = "";
    } catch (error) {
      const message = String(error?.message || error);
      if (message !== lastError) {
        logger.warn?.("Arkadaslarin canli verisi alinamadi", message);
      }
      lastError = message;
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (!timer) {
        timer = setInterval(tick, intervalMs);
      }
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    /**
     * Verilen maca ait, yeterince taze uzak durum. Yoksa `null`.
     * @param {string} matchId
     */
    stateFor(matchId) {
      if (
        !latest?.state ||
        latest.matchId !== String(matchId || "").trim() ||
        Date.now() - latest.at > MAX_AGE_MS
      ) {
        return null;
      }
      return latest.state;
    },

    /** Debug paneli icin. */
    status: () => ({
      matchId: latest?.matchId || "",
      at: latest ? new Date(latest.at).toISOString() : "",
      uploaders: latest?.state?.uploaders || [],
      error: lastError,
    }),
  };
}

module.exports = {
  createCloudLiveWatcher,
};
