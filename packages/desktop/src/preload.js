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

  /**
   * Siteye Steam ile giris penceresi acar.
   *
   * Canli mac verisini siteye gonderebilmek icin kimlik gerekiyor. Giris
   * tamamlaninca cerez Electron oturumuna yazilir ve role onu kullanir;
   * kullanicinin ayarlara elle gizli anahtar yapistirmasi gerekmez.
   */
  cloudLogin: () => ipcRenderer.invoke("dotastat:cloud-login"),

  /** Site oturumunu kapatir. */
  cloudLogout: () => ipcRenderer.invoke("dotastat:cloud-logout"),

  /** Arayuz masaustunde mi calisiyor? */
  isDesktop: true,
});
