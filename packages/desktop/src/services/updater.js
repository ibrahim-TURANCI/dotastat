/**
 * Otomatik guncelleme (GitHub Releases uzerinden).
 *
 * `electron-builder` yayin hedefi olarak GitHub secili oldugu icin
 * `electron-updater` yeni surumu kendisi bulur. Paketlenmemis (gelistirme)
 * modda hicbir sey yapmaz.
 *
 * DIKKAT: `electron-updater` in `autoUpdater` alani tembel bir getter'dir ve
 * ilk okundugunda Electron'un `app` nesnesine erisir. Modul yuklenirken
 * (yani `app` hazir olmadan) okunursa uygulama aciliste cokuyor. Bu yuzden
 * asagida yalnizca `createUpdater` cagrildiginda okunur.
 */

const electronUpdater = require("electron-updater");

/**
 * @param {Object} options
 * @param {Electron.App} options.app
 * @param {(label: string) => void} [options.onStatus]
 * @param {{ info: Function, warn: Function, error: Function }} [options.logger]
 */
function createUpdater(options) {
  const logger = options.logger || console;
  const setStatus = options.onStatus || (() => {});

  if (!options.app.isPackaged) {
    setStatus("gelistirme modu");
    return {
      check: () => setStatus("gelistirme modunda guncelleme yok"),
    };
  }

  const autoUpdater = electronUpdater.autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => setStatus("kontrol ediliyor"));
  autoUpdater.on("update-available", (info) =>
    setStatus("yeni surum indiriliyor: " + info?.version),
  );
  autoUpdater.on("update-not-available", () => setStatus("guncel"));
  autoUpdater.on("download-progress", (progress) =>
    setStatus("indiriliyor %" + Math.round(progress?.percent || 0)),
  );
  autoUpdater.on("update-downloaded", () =>
    setStatus("indirildi, cikista kurulacak"),
  );
  autoUpdater.on("error", (error) => {
    logger.warn?.("Guncelleme hatasi", String(error?.message || error));
    setStatus("hata");
  });

  return {
    check() {
      autoUpdater.checkForUpdates().catch((error) => {
        logger.warn?.(
          "Guncelleme kontrolu basarisiz",
          String(error?.message || error),
        );
      });
    },
  };
}

module.exports = {
  createUpdater,
};
