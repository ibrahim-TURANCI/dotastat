/**
 * Preload betigi.
 *
 * Not: Preload CommonJS olmak zorundadir; Electron sandbox'i ESM preload
 * yuklemez. Paket zaten CommonJS oldugu icin uzanti `.js` yeterli.
 *
 * Arayuze yalnizca ihtiyac duyulan uc islev acilir; Node API'si sizdirilmaz.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dotastat", {
  /** Uygulama surumu, sunucu adresi, gunluk dosyasi vb. */
  info: () => ipcRenderer.invoke("dotastat:info"),

  /** Dota'nin cfg klasorune GSI dosyasini yazar. */
  installGsi: () => ipcRenderer.invoke("dotastat:install-gsi"),

  /** Gunluk dosyasini Dosya Gezgini'nde gosterir. */
  openLog: () => ipcRenderer.invoke("dotastat:open-log"),

  /** Arayuz masaustunde mi calisiyor? */
  isDesktop: true,
});
