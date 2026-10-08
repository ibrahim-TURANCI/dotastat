/**
 * Sunucu kurulumu: cekirdek + ayarlar + depo + role + Express uygulamasi.
 *
 * Electron ana sureci de, `npm run serve` ile calisan bagimsiz mod da bu
 * fonksiyonu kullanir. Fark yalnizca klasor yollarinin nereden geldigidir.
 */

const path = require("node:path");
const { loadCore } = require("../core-bridge.js");
const { createServerApp } = require("./app.js");
const { createFileStore } = require("./storage.js");
const { createSettingsStore } = require("./settings.js");
const { configureDeviceIdentity } = require("../services/cloud-session.js");
const { createCloudRelay } = require("../services/cloud-relay.js");
const { createCloudLiveWatcher } = require("../services/cloud-live.js");
const { createCloudPresence } = require("../services/cloud-presence.js");
const { createMmrWatcher } = require("../services/mmr-watcher.js");
const { createOverwolfWatcher } = require("../services/overwolf-watcher.js");

/** Varsayilan port. Dota GSI yapilandirmasi da bu portu kullanir. */
const DEFAULT_PORT = 3044;

/**
 * @param {Object} options
 * @param {string} options.userDataDir Ayar ve onbellek dosyalarinin klasoru
 * @param {string} [options.webDir] Derlenmis arayuz klasoru
 * @param {number} [options.port]
 * @param {string} [options.version]
 * @param {{ info: Function, warn: Function, error: Function }} [options.logger]
 */
async function startServer(options) {
  const logger = options.logger || console;
  const port = Number(options.port) || Number(process.env.PORT) || DEFAULT_PORT;

  // ES modulu olan cekirdek burada bir kez yuklenir.
  const core = await loadCore();

  const settings = createSettingsStore(
    path.join(options.userDataDir, "settings.json"),
  );
  const storage = createFileStore(
    path.join(options.userDataDir, "player-cache.json"),
  );

  // Siteye giden her istek bu kurulumun cihaz kimligini tasir; Steam girisi
  // gerekmez. SteamID oyundan (GSI) tespit edilir.
  configureDeviceIdentity(() => ({
    steamId: settings.resolveSteamId(),
    key: settings.deviceKey(),
  }));

  const relay = createCloudRelay({
    logger,
    getConfig: () => {
      const current = settings.get();
      return {
        cloudUrl: current.cloudUrl,
        ingestToken: current.ingestToken,
        shareLive: Boolean(current.shareLive),
        steamId: settings.resolveSteamId(),
      };
    },
  });

  // MMR yalnizca DotaPlus kuruluysa okunabilir; degilse sessizce bos kalir.
  const mmr = createMmrWatcher({
    storage,
    core,
    logger,
    getConfig: () => ({ cloudUrl: settings.get().cloudUrl }),
  });
  mmr.start();

  // Overwolf/DotaPlus ISTEGE BAGLI ek kaynaktir: canli macta 10 slotun
  // hero'sunu ve rank'ini verir. Kurulu degilse servis sessizce bos doner ve
  // uygulama yalnizca GSI ile eskisi gibi calisir.
  //
  // Degisiklik geri cagrisi sunucu kurulduktan SONRA baglanir; bu yuzden
  // burada bir tutamac uzerinden cagrilir.
  let onOverwolfChange = () => {};
  const overwolf = createOverwolfWatcher({
    core,
    logger,
    isEnabled: () => settings.get().useOverwolf !== false,
    onChange: () => onOverwolfChange(),
  });

  // Ayni maci siteye gonderen DIGER DotaStat kullanicilarinin verisi (takim
  // arkadaslarinin envanteri, Overwolf'lu birinin 10 slotu). Yerel durum
  // sunucu kurulduktan sonra baglanir.
  let getLocalLiveState = () => null;
  const cloudLive = createCloudLiveWatcher({
    logger,
    getConfig: () => ({
      cloudUrl: settings.get().cloudUrl,
      steamId: settings.resolveSteamId(),
    }),
    getLocalState: () => getLocalLiveState(),
  });

  // Bu bilgisayarin kullanicisini sitedeki online listesine ekler ve listeyi
  // geri alir. Oyun durumu sunucu kurulduktan sonra baglanir.
  const cloudPresence = createCloudPresence({
    logger,
    getConfig: () => ({
      cloudUrl: settings.get().cloudUrl,
      steamId: settings.resolveSteamId(),
    }),
    getStatus: () => {
      const local = getLocalLiveState();
      const steamId = settings.resolveSteamId();
      const own = [
        ...(local?.radiantPlayers || []),
        ...(local?.direPlayers || []),
      ].find((row) => steamId && String(row?.steamId || "") === steamId);
      return {
        inGame: Boolean(local),
        hero: String(own?.hero || ""),
        matchId: String(local?.matchId || ""),
      };
    },
  });

  const app_ = createServerApp({
    core,
    settings,
    storage,
    relay,
    mmr,
    overwolf,
    cloudLive,
    cloudPresence,
    webDir: options.webDir || "",
    logger,
    version: options.version || "",
    port,
  });
  const { app, getLiveState, getOverlayState, playerData } = app_;
  onOverwolfChange = app_.onOverwolfChange;
  getLocalLiveState = app_.getLocalLiveState;
  overwolf.start();
  cloudLive.start();
  cloudPresence.start();

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  logger.info?.("Sunucu hazir: http://127.0.0.1:" + port);

  return {
    port,
    url: "http://127.0.0.1:" + port,
    core,
    settings,
    relay,
    mmr,
    overwolf,
    playerData,
    getLiveState,
    getOverlayState,
    async stop() {
      relay.stop();
      mmr.stop();
      overwolf.stop();
      cloudLive.stop();
      await cloudPresence.stop();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  DEFAULT_PORT,
  startServer,
};
