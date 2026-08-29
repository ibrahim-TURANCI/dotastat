/**
 * Sistem tepsisi (tray) simgesi.
 *
 * BOS SIMGE SORUNU VE COZUMU
 * --------------------------
 * Kurulumdan sonra tepsideki (ve "gizli simgeler" panelindeki) ikon bos
 * gorunuyorsa sebebi neredeyse her zaman su ucundan biridir:
 *
 *   1. `nativeImage.createFromPath` asar arsivi ICINDEKI dosyalari guvenilir
 *      sekilde okuyamaz; bos bir gorsel doner ve Windows bos kare cizer.
 *      -> Cozum: ikon `extraResources` ile asar DISINA kopyalanir ve
 *         ayrica `fs.readFileSync` + `createFromBuffer` ile okunur.
 *
 *   2. Tek katmanli bir PNG 16x16'ya zorla kucultuldugunde, olcekli
 *      ekranlarda (125/150/200 %) Windows uygun katmani bulamaz.
 *      -> Cozum: cok katmanli `.ico` (16/20/24/32/40/48) kullanilir ve
 *         `resize` ile ZORLA kucultulmez.
 *
 *   3. Hicbir aday okunamazsa gorsel tamamen bos kalir.
 *      -> Cozum: gomulu base64 PNG son care olarak devreye girer.
 *
 * Yuklenen her aday `isEmpty()` ile dogrulanir; bos olan atlanir.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Menu, Tray, nativeImage } = require("electron");

/**
 * Son care 16x16 PNG (mavi-yesil "D" isareti).
 * Electron'un nativeImage'i SVG COZMEZ; bu yuzden yedek PNG olmak zorunda.
 */
const FALLBACK_TRAY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAADsOAAA7DgHMtqGD" +
  "AAABj0lEQVR4nM3QT0vCcBjAcd9BRPT3ZdRb6BYdF2FMW6ataWaYrELE415FhBDFrIgQMsqD" +
  "EgYarJxu+2375QzqUIc6dDCJntCmJJt0rOf68PnC8zgc/2ZiwgcbLdXZrdIbu1F6ZSPlZ3Zd" +
  "egiFxNq0X5IGfg1Eb+uwVXoDVnyBSPkZwpVHWJPuYVXC4JfRO6OIO7R+M9QzsNkDB2QEjFIG" +
  "Gt2AVy1in3Q9ahtgW/ipjROhCp5kKgrJKCJPK8KnTy3ConYFlJrbtw1EOrgGKxUc/7nzqoXY" +
  "opYHSsuBS880CHzeZwmETRxs3Sx3BTz4ariJ3XoGSHwGTj01YQmsmTggK7Asi12BBflyrI3n" +
  "7lIwY5yMWwJBEzcftoSEroBby8TbeLZ63CAwbz0hYGIaCeBDxQSF8pPzetbt0i4OSD39aWIg" +
  "jOSe7RMZRfzGagE8zYfp2c7NHVxN6kSVH7EN0EgArwWnTXxUJ4zkNvHID9ri5nhRgfNoeY7S" +
  "spxby3AkPo0771LBWeNwylnb7e8J/3y+AF+vRmzte02KAAAAAElFTkSuQmCC";

/**
 * Tepsi ikonunu yukler.
 *
 * @param {{ resourcesDir: string, appDir: string }} paths
 * @returns {{ image: Electron.NativeImage, source: string }}
 */
function loadTrayIcon(paths) {
  const candidates = [
    // 1. Paketlenmis kurulumda asar DISINDAKI kopyalar (tercih edilen).
    path.join(paths.resourcesDir || "", "tray.ico"),
    path.join(paths.resourcesDir || "", "tray.png"),
    path.join(paths.resourcesDir || "", "icon.ico"),
    // 2. Gelistirme sirasinda kaynak klasoru.
    path.join(paths.appDir || "", "resources", "tray.ico"),
    path.join(paths.appDir || "", "resources", "tray.png"),
    path.join(paths.appDir || "", "build", "icon.ico"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    // Once createFromPath: Windows'ta cok katmanli `.ico` dosyalarini yalnizca
    // bu yol cozebiliyor (buffer yolu sadece PNG/JPEG cozer).
    try {
      const fromPath = nativeImage.createFromPath(candidate);
      if (!fromPath.isEmpty()) {
        return { image: fromPath, source: candidate };
      }
    } catch {
      // Bir sonraki yonteme gecilir.
    }

    // Sonra buffer: asar arsivi icindeki dosyalarda createFromPath bos gorsel
    // dondurebiliyor.
    try {
      const fromBuffer = nativeImage.createFromBuffer(
        fs.readFileSync(candidate),
      );
      if (!fromBuffer.isEmpty()) {
        return { image: fromBuffer, source: candidate };
      }
    } catch {
      // Okunamayan aday atlanir.
    }
  }

  const fallback = nativeImage.createFromBuffer(
    Buffer.from(FALLBACK_TRAY_PNG_BASE64, "base64"),
  );
  return { image: fallback, source: "gomulu-yedek" };
}

/**
 * Tepsi simgesini ve menusunu olusturur.
 *
 * @param {Object} options
 * @param {Electron.App} options.app
 * @param {Electron.BrowserWindow} options.window
 * @param {{ resourcesDir: string, appDir: string }} options.paths
 * @param {string} options.serverUrl
 * @param {() => void} [options.onCheckUpdates]
 * @param {() => void} [options.onInstallGsi]
 * @param {{ info: Function, warn: Function }} [options.logger]
 */
function createTray(options) {
  const { app, window, paths } = options;
  const logger = options.logger || console;

  const { image, source } = loadTrayIcon(paths);
  logger.info?.("Tepsi ikonu kaynagi: " + source);

  const tray = new Tray(image);
  tray.setToolTip("DotaStat — " + options.serverUrl);

  let statusLabel = "Durum: hazir";

  function showWindow() {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }

  function buildMenu() {
    return Menu.buildFromTemplate([
      { label: "DotaStat " + (app.getVersion?.() || ""), enabled: false },
      { label: statusLabel, enabled: false },
      { type: "separator" },
      { label: "Aç", click: showWindow },
      { label: "Gizle", click: () => window.hide() },
      {
        label: "GSI dosyasını kur",
        click: () => options.onInstallGsi?.(),
      },
      {
        label: "Güncelleme kontrol et",
        click: () => options.onCheckUpdates?.(),
      },
      { type: "separator" },
      {
        label: "Çıkış",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
  }

  tray.setContextMenu(buildMenu());

  tray.on("click", () => {
    if (window.isVisible() && !window.isMinimized()) {
      window.hide();
    } else {
      showWindow();
    }
  });

  return {
    tray,
    iconSource: source,
    /**
     * @param {string} label
     */
    setStatus(label) {
      statusLabel = "Durum: " + (String(label || "").trim() || "bilinmiyor");
      tray.setContextMenu(buildMenu());
    },
    destroy() {
      tray.destroy();
    },
  };
}

module.exports = {
  loadTrayIcon,
  createTray,
};
