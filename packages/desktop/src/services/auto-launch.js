/**
 * Windows oturum acilisinda otomatik baslatma.
 *
 * NE YAPAR: `app.setLoginItemSettings` ile kullaniciya ait Run kaydini
 * (HKCU\Software\Microsoft\Windows\CurrentVersion\Run) yazar ya da siler.
 * Yonetici hakki gerektirmez; kayit YALNIZCA kuran kullanici icin gecerlidir.
 *
 * NEDEN KURULUM SCRIPTI DEGIL DE CALISMA ZAMANI
 * ---------------------------------------------
 * Kaydi NSIS'e yazdirmak da mumkundu ama o zaman ayar tek yonlu olurdu:
 * kullanici "otomatik baslama" dedikten sonra kaydi geri almanin yolu
 * kalmazdi. Burada ayar dosyasindaki `autoLaunch` ile kayit her acilista
 * eslenir; kutucugu kapatmak kaydi gercekten siler.
 *
 * PAKETLENMEMIS UYGULAMADA HIC CALISMAZ
 * -------------------------------------
 * Gelistirmede `process.execPath` Electron'un kendi exe'si oluyor ve kayit
 * "electron.exe --hidden <proje yolu>" gibi bir seye isaret ediyordu: makine
 * her acildiginda gelistirme kopyasi kalkiyordu. Bu yuzden yalnizca
 * `app.isPackaged` iken yazilir.
 *
 * ACILISTA PENCERE ACILMAZ
 * ------------------------
 * Kayda `--hidden` argumani konur ve ana surec bu argumani gorunce pencereyi
 * hic gostermez (bkz. main.js). Ayarlardaki "Acilista simge durumunda baslat"
 * ELLE acmayi anlatiyor; makine acilisinda pencerenin one firlamasi her
 * durumda yanlis olurdu — kullanici o an bilgisayarini acmakla mesgul.
 */

/** Run kaydinin adi. Sabit tutulur: degisirse eski kayit ortada kalir. */
const LOGIN_ITEM_NAME = "DotaStat";

/** Oturum acilisindan gelen calistirmayi isaretleyen arguman. */
const HIDDEN_FLAG = "--hidden";

/**
 * Bu calistirma, oturum acilisindan mi geliyor?
 *
 * @param {string[]} [argv]
 * @returns {boolean}
 */
function launchedHidden(argv = process.argv) {
  return (argv || []).includes(HIDDEN_FLAG);
}

/**
 * Ayardaki degeri isletim sistemine yazar.
 *
 * Yazma BASARISIZ OLABILIR (grup ilkesi, kilitli kayit defteri) ve bu
 * uygulamanin baslamasini engellememeli: hata gunluge dusurulur, uygulama
 * calismaya devam eder.
 *
 * @param {Object} input
 * @param {Electron.App} input.app
 * @param {boolean} input.enabled
 * @param {{ info: Function, warn: Function }} [input.logger]
 * @returns {{ ok: boolean, applied: boolean, error?: string }}
 */
function applyAutoLaunch({ app, enabled, logger = console }) {
  if (process.platform !== "win32") {
    return { ok: true, applied: false };
  }
  if (!app.isPackaged) {
    logger.info?.(
      "Otomatik baslatma paketlenmemis uygulamada uygulanmaz (ayar: " +
        (enabled ? "acik" : "kapali") +
        ")",
    );
    return { ok: true, applied: false };
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      name: LOGIN_ITEM_NAME,
      // Guncelleme sonrasi exe yolu degisebiliyor; her acilista guncel yol
      // yazilir, yoksa kayit eski surumu gostermeye devam ederdi.
      path: process.execPath,
      args: [HIDDEN_FLAG],
    });
    logger.info?.(
      "Otomatik baslatma " + (enabled ? "acildi" : "kapatildi") + ".",
    );
    return { ok: true, applied: true };
  } catch (error) {
    const message = String(error?.message || error);
    logger.warn?.("Otomatik baslatma ayarlanamadi: " + message);
    return { ok: false, applied: false, error: message };
  }
}

module.exports = {
  applyAutoLaunch,
  launchedHidden,
  HIDDEN_FLAG,
  LOGIN_ITEM_NAME,
};
