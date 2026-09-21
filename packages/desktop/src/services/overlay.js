/**
 * Oyun ici overlay: Dota on plandayken ekranin sag altinda, Discord'un oyun
 * ustu bildirimleri gibi soluk duran kucuk bir item tavsiyesi seridi.
 *
 * PENCERE: seffaf, cercevesiz, her zaman ustte, odak ALMAZ ve fareyi ALTINA
 * gecirir. Yani oyunda tiklamayi, kamerayi, kisayollari hic etkilemez.
 *
 * NE ZAMAN GORUNUR: ayar acik + Dota on planda + mac suruyor (PRE_GAME ya da
 * GAME_IN_PROGRESS) + kendi satirimiz icin en az bir tavsiye var.
 *
 * SINIR: Dota "Tam ekran" (exclusive fullscreen) modundayken hicbir harici
 * pencere oyunun ustune cizilemez; Discord bunu oyuna kod enjekte ederek
 * asiyor, biz etmiyoruz. Overlay "Kenarliksiz pencere" (borderless) modunda
 * calisir.
 */

const path = require("node:path");
const { BrowserWindow, screen } = require("electron");
const { createForegroundWatcher } = require("./foreground-watcher.js");

/** Dota'nin Windows'taki surec adi. */
const DOTA_PROCESS = "dota2";
const POLL_MS = 1200;

/**
 * 4 ikon (44x32) + araliklar. Yukseklik ikonla AYNI: pencere seridin alt
 * kenarina gore konumlaniyor, fazlasi yalnizca hesabi bulandirir.
 */
const WIDTH = 190;
const HEIGHT = 32;
/**
 * Pencerenin alt kenarinin ekranin altindan uzakligi (ekran yuksekligine
 * oran). Dota'nin HUD'u ekran YUKSEKLIGIYLE olceklendigi icin oran her
 * cozunurlukte ayni yere denk gelir.
 *
 * Serit Zula (stash) panelinin tam ustune oturur: 1080p'de panelin ust
 * kenari ~204 px. Zula ile hizli alim arasindaki bosluk denendi ama o alan
 * oyunda bazi durumlarda doluyor.
 */
const BOTTOM_RATIO = 0.19;
/** Zula paneli gibi ekranin sag kenarina yaslidir. */
const RIGHT_MARGIN = 0;

/**
 * @param {Object} options
 * @param {{ info: Function, warn: Function }} options.logger
 * @param {() => Promise<Record<string, any>>} options.getState
 * @param {() => boolean} options.isEnabled
 */
function createOverlay(options) {
  const { logger, getState, isEnabled } = options;
  const foreground = createForegroundWatcher({ logger });

  /** @type {BrowserWindow|null} */
  let window = null;
  /** @type {NodeJS.Timeout|null} */
  let timer = null;
  let lastPayload = "";
  let busy = false;

  function bounds() {
    const { bounds: area } = screen.getPrimaryDisplay();
    return {
      x: Math.round(area.x + area.width - WIDTH - RIGHT_MARGIN),
      y: Math.round(area.y + area.height * (1 - BOTTOM_RATIO) - HEIGHT),
      width: WIDTH,
      height: HEIGHT,
    };
  }

  function ensureWindow() {
    if (window && !window.isDestroyed()) {
      return window;
    }

    window = new BrowserWindow({
      ...bounds(),
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "..", "overlay", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    // "screen-saver" seviyesi borderless oyun penceresinin de ustunde kalir.
    window.setAlwaysOnTop(true, "screen-saver");
    window.setIgnoreMouseEvents(true);
    window.loadFile(path.join(__dirname, "..", "overlay", "overlay.html"));
    window.webContents.once("did-finish-load", () => {
      if (lastPayload) {
        window?.webContents.send("overlay:update", JSON.parse(lastPayload));
      }
    });
    window.on("closed", () => {
      window = null;
    });
    return window;
  }

  function hide() {
    if (window && !window.isDestroyed() && window.isVisible()) {
      window.hide();
    }
  }

  async function tick() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      if (!isEnabled()) {
        hide();
        return;
      }

      // Odak bilinmiyorsa (izleyici calismiyor) yalnizca mac durumuna bakilir.
      const front = foreground.current();
      if (front !== null && front.toLowerCase() !== DOTA_PROCESS) {
        hide();
        return;
      }

      const state = await getState();
      if (!state?.active || !state.items?.length) {
        hide();
        return;
      }

      const target = ensureWindow();
      const payload = JSON.stringify({ hero: state.hero, items: state.items });
      if (payload !== lastPayload) {
        lastPayload = payload;
        if (!target.webContents.isLoading()) {
          target.webContents.send("overlay:update", state);
        }
      }
      if (!target.isVisible()) {
        // Cozunurluk oyun icinde degismis olabilir.
        target.setBounds(bounds());
        target.showInactive();
      }
    } catch (error) {
      logger.warn?.("Overlay guncellenemedi", String(error?.message || error));
      hide();
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) {
        return;
      }
      foreground.start();
      timer = setInterval(tick, POLL_MS);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      foreground.stop();
      if (window && !window.isDestroyed()) {
        window.destroy();
      }
      window = null;
    },
  };
}

module.exports = { createOverlay };
