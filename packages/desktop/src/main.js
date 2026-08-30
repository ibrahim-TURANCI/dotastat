/**
 * Electron ana sureci.
 *
 * Sorumluluklari kucuk tutulmustur:
 *   1. Yerel sunucuyu (3044) baslat.
 *   2. Pencereyi ac ve sunucunun servis ettigi arayuzu yukle.
 *   3. Tepsi simgesi, GSI kurulumu ve guncelleyiciyi bagla.
 *
 * Is mantigi burada DEGIL; `src/server` ve `@dotastat/core` icindedir.
 *
 * Not: Masaustu paketi CommonJS'tir (Electron ana sureci, electron-builder ve
 * electron-updater icin en yaygin ve en az surprizli kurulum). `@dotastat/core`
 * ise saf ES modulu olarak kalir; iki dunya `src/core-bridge.js` uzerinden tek
 * noktada birlesir.
 */

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, app, ipcMain, shell } = require("electron");

const { DEFAULT_PORT, startServer } = require("./server/index.js");
const { createLogger } = require("./services/logger.js");
const { createTray } = require("./services/tray.js");
const { createUpdater } = require("./services/updater.js");
const { clearCloudSession } = require("./services/cloud-session.js");
const {
  findDotaCfgDir,
  installGsiConfig,
} = require("./services/gsi-config.js");

const appDir = path.resolve(__dirname, "..");

// Ayni anda iki kopya calisirsa 3044 portu cakisir; ikinci kopya var olan
// pencereyi one getirir ve kapanir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {Awaited<ReturnType<typeof startServer>>|null} */
let server = null;
/** @type {ReturnType<typeof createTray>|null} */
let tray = null;

const logger = createLogger({ dir: app.getPath("userData") });

/**
 * Paketlenmis uygulamada arayuz `web/`, gelistirmede `packages/web/dist`
 * altindadir.
 * @returns {string}
 */
function resolveWebDir() {
  const packaged = path.join(appDir, "web");
  if (fs.existsSync(path.join(packaged, "index.html"))) {
    return packaged;
  }
  const development = path.resolve(appDir, "..", "web", "dist");
  return fs.existsSync(path.join(development, "index.html")) ? development : "";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b1420",
    autoHideMenuBar: true,
    icon: path.join(process.resourcesPath || appDir, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!server?.settings.get().startMinimized) {
      mainWindow?.show();
    }
  });

  // Pencere kapatilinca uygulama kapanmaz, tepsiye iner.
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Dis baglantilar varsayilan tarayicida acilir.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return mainWindow;
}

/**
 * GSI yapilandirmasini kurar ve sonucu gunluge yazar.
 * @param {{ silent?: boolean }} [options]
 */
function setupGsi(options = {}) {
  const result = installGsiConfig({ port: server?.port || DEFAULT_PORT });

  if (result.ok) {
    logger.info(
      result.changed
        ? "GSI dosyasi yazildi: " + result.path + " (Dota yeniden baslatilmali)"
        : "GSI dosyasi zaten guncel: " + result.path,
    );
  } else {
    logger.warn("GSI dosyasi kurulamadi: " + result.error);
  }

  if (!options.silent) {
    tray?.setStatus(result.ok ? "GSI kuruldu" : "GSI kurulamadi");
  }
  return result;
}

app.on("second-instance", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  const webDir = resolveWebDir();
  if (!webDir) {
    logger.warn(
      "Derlenmis arayuz bulunamadi. `npm run build:web` calistirilmali.",
    );
  }

  try {
    server = await startServer({
      userDataDir: app.getPath("userData"),
      webDir,
      version: app.getVersion(),
      logger,
    });
  } catch (error) {
    logger.error("Sunucu baslatilamadi", String(error?.message || error));
    app.quit();
    return;
  }

  const window = createWindow();
  await window.loadURL(server.url);

  const updater = createUpdater({
    app,
    logger,
    onStatus: (label) => tray?.setStatus(label),
  });

  tray = createTray({
    app,
    window,
    logger,
    paths: { resourcesDir: process.resourcesPath || "", appDir },
    serverUrl: server.url,
    onCheckUpdates: () => updater.check(),
    onInstallGsi: () => setupGsi(),
  });

  if (server.settings.get().autoInstallGsi) {
    setupGsi({ silent: true });
  }

  updater.check();

  logger.info(
    "DotaStat hazir. Dota cfg klasoru: " + (findDotaCfgDir() || "bulunamadi"),
  );
});

app.on("window-all-closed", () => {
  // Tepsi uygulamasi: pencereler kapansa da arka planda kalir.
  if (process.platform !== "win32") {
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", async () => {
  tray?.destroy();
  await server?.stop();
});

// --- Arayuzden gelen istekler -------------------------------------------------

ipcMain.handle("dotastat:info", () => ({
  version: app.getVersion(),
  serverUrl: server?.url || "",
  logPath: logger.filePath,
  dotaCfgDir: findDotaCfgDir(),
  trayIconSource: tray?.iconSource || "",
}));

ipcMain.handle("dotastat:install-gsi", () => setupGsi());

ipcMain.handle("dotastat:open-log", () => {
  shell.showItemInFolder(logger.filePath);
  return true;
});

/**
 * Siteye Steam ile giris.
 *
 * Ayri bir pencerede sitenin OpenID akisi acilir. Steam donusu sitenin
 * `/api/auth/return` ucuna gelir, cerez EKLENTISIZ paylasilan varsayilan
 * Electron oturumuna yazilir ve role (cloud-relay) onu kullanir.
 *
 * Pencere, site `?login=` parametresiyle geri dondugunde kendiliginden
 * kapanir; kullanicinin adres cubugunu takip etmesi gerekmez.
 */
ipcMain.handle("dotastat:cloud-login", async () => {
  const cloudUrl = String(server?.settings.get().cloudUrl || "").trim();
  if (!cloudUrl) {
    return { ok: false, error: "site-adresi-yok" };
  }

  const base = cloudUrl.replace(/\/+$/, "");
  const loginWindow = new BrowserWindow({
    width: 980,
    height: 760,
    title: "Steam ile giriş",
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const finished = new Promise((resolve) => {
    let settled = false;

    /** @param {string} url */
    const check = (url) => {
      if (settled || !url.startsWith(base)) {
        return;
      }
      // Site donuste `?login=ok` (veya `login=hata`) ekliyor.
      if (!/[?&]login=/.test(url)) {
        return;
      }
      settled = true;
      const ok = /[?&]login=ok/.test(url);
      loginWindow.close();
      resolve({ ok, error: ok ? "" : "giris-basarisiz" });
    };

    loginWindow.webContents.on("did-navigate", (_event, url) => check(url));
    loginWindow.webContents.on("did-navigate-in-page", (_event, url) =>
      check(url),
    );
    loginWindow.on("closed", () => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: "iptal" });
      }
    });
  });

  await loginWindow.loadURL(base + "/api/auth/login");
  const result = await finished;

  // Giris basariliysa arayuz yeni durumu okusun.
  if (result.ok) {
    mainWindow?.webContents.reload();
  }
  return result;
});

ipcMain.handle("dotastat:cloud-logout", async () => {
  const cloudUrl = String(server?.settings.get().cloudUrl || "").trim();
  const ok = await clearCloudSession(cloudUrl);
  mainWindow?.webContents.reload();
  return { ok };
});
