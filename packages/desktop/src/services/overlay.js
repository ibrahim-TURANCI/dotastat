/**
 * Oyun ici overlay: Dota on plandayken, Discord'un oyun ustu bildirimleri
 * gibi soluk duran kucuk bir tavsiye penceresi. Iki modu var:
 *   - "draft": hero secimi sirasinda ekranin SAG kenarinda, pozisyon basina
 *     alt alta hero onerileri ve puanlari (son pick yapilinca kaybolur).
 *   - "items": mac basladiktan sonra sag altta item tavsiyesi seridi.
 *
 * PENCERE: seffaf, cercevesiz, her zaman ustte, odak ALMAZ ve fareyi ALTINA
 * gecirir. Yani oyunda tiklamayi, kamerayi, kisayollari hic etkilemez.
 *
 * NE ZAMAN GORUNUR: ayar acik + Dota on planda + (hero secimi suruyor ve
 * draft onerisi var) ya da (mac suruyor ve kendi satirimiz icin en az bir
 * item tavsiyesi var).
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
 * Draft modu: 5 pozisyon sutunu, her sutunda en fazla 5 hero (ikon + puan).
 * Olculer 1080p icin; pencere ekran yuksekligiyle olceklenir (Dota'nin
 * HUD'u da oyle).
 */
const DRAFT_WIDTH = 196;
const DRAFT_HEIGHT = 290;
/**
 * Pencerenin ust kenarinin ekranin ustunden uzakligi (yukseklige oran).
 * Pick ekraninda ust hero seridinin hemen altina, saga yasli durur; 16:9'da
 * sagdaki "Dostlar ve dusmanlar" panelinin disinda kalan bosluga denk gelir.
 */
const DRAFT_TOP_RATIO = 0.15;
const DRAFT_RIGHT_MARGIN = 6;

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

  /** Gosterilen mod ("items" | "draft"); konum ve boyut buna gore. */
  let mode = "items";

  /** Ekran yuksekligi / 1080: draft modunun olcegi. */
  function scale() {
    const { bounds: area } = screen.getPrimaryDisplay();
    return Math.max(0.6, area.height / 1080);
  }

  function bounds() {
    const { bounds: area } = screen.getPrimaryDisplay();
    if (mode === "draft") {
      const factor = scale();
      const width = Math.round(DRAFT_WIDTH * factor);
      return {
        x: Math.round(
          area.x + area.width - width - DRAFT_RIGHT_MARGIN * factor,
        ),
        y: Math.round(area.y + area.height * DRAFT_TOP_RATIO),
        width,
        height: Math.round(DRAFT_HEIGHT * factor),
      };
    }
    return {
      x: Math.round(area.x + area.width - WIDTH - RIGHT_MARGIN),
      y: Math.round(area.y + area.height * (1 - BOTTOM_RATIO) - HEIGHT),
      width: WIDTH,
      height: HEIGHT,
    };
  }

  /** Pencereyi moda gore konumlar; draft modu ekranla olceklenir. */
  function place(target) {
    target.setBounds(bounds());
    target.webContents.setZoomFactor(mode === "draft" ? scale() : 1);
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
      window?.webContents.setZoomFactor(mode === "draft" ? scale() : 1);
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
      const nextMode = state?.mode === "draft" ? "draft" : "items";
      const hasContent =
        nextMode === "draft" ? state?.roles?.length : state?.items?.length;
      if (!state?.active || !hasContent) {
        hide();
        return;
      }

      const target = ensureWindow();
      const modeChanged = nextMode !== mode;
      mode = nextMode;
      const payload = JSON.stringify({
        mode,
        hero: state.hero,
        items: state.items,
        roles: state.roles,
      });
      if (payload !== lastPayload) {
        lastPayload = payload;
        if (!target.webContents.isLoading()) {
          target.webContents.send("overlay:update", JSON.parse(payload));
        }
      }
      if (modeChanged) {
        place(target);
      }
      if (!target.isVisible()) {
        // Cozunurluk oyun icinde degismis olabilir.
        place(target);
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
