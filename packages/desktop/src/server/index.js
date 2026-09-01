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
const { createCloudRelay } = require("../services/cloud-relay.js");
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

  const app_ = createServerApp({
    core,
    settings,
    storage,
    relay,
    mmr,
    overwolf,
    webDir: options.webDir || "",
    logger,
    version: options.version || "",
    port,
  });
  const { app, getLiveState, playerData } = app_;
  onOverwolfChange = app_.onOverwolfChange;
  overwolf.start();

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
    async stop() {
      relay.stop();
      mmr.stop();
      overwolf.stop();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  DEFAULT_PORT,
  startServer,
};
