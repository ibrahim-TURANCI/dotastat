/**
 * Oyun ici overlay: Dota on plandayken, Discord'un oyun ustu bildirimleri
 * gibi soluk duran kucuk bir tavsiye penceresi. Iki modu var:
 *   - "draft": hero secimi sirasinda ekranin SAG kenarinda, pozisyon basina
 *     alt alta hero onerileri ve puanlari (son pick yapilinca kaybolur).
 *   - "items": mac basladiktan sonra sag altta item tavsiyesi seridi;
 *     dizilimi, yuksekligi ve opakligi ayarlardan secilir.
 *
 * PENCERE: seffaf, cercevesiz, her zaman ustte, odak ALMAZ ve fareyi ALTINA
 * gecirir. Yani oyunda tiklamayi, kamerayi, kisayollari hic etkilemez.
 *
 * NE ZAMAN GORUNUR: o modun ayari acik + Dota on planda + (hero secimi suruyor ve
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
 * Item seridinin dizilimleri: 4 ikon (44x32), 4 px aralik. Pencere ikonlarla
 * AYNI boyda: alt kenara ve sag kenara gore konumlaniyor, fazlasi yalnizca
 * hesabi bulandirir. Uc dizilim de ayni sag alt koseye yaslanir:
 *   - horizontal: 4 yan yana (varsayilan)
 *   - vertical:   en sagdaki itemin yerinden yukari dogru alt alta
 *   - grid:       2x2; alt satir en sagdaki iki itemin yeri
 * Arayuzdeki on izleme (web SettingsPanel) ayni olculeri kullanir.
 */
const ITEM_LAYOUTS = {
  horizontal: { width: 188, height: 32 },
  vertical: { width: 44, height: 140 },
  grid: { width: 92, height: 68 },
};
/**
 * Seridin alt kenarinin ekranin altindan uzakligi (yukseklige yuzde).
 * Dota'nin HUD'u ekran YUKSEKLIGIYLE olceklendigi icin oran her
 * cozunurlukte ayni yere denk gelir.
 *
 * En dusuk deger Zula (stash) panelinin tam ustu: 1080p'de panelin ust
 * kenari ~204 px. Daha asagisi HUD'a biner; Zula ile hizli alim arasindaki
 * bosluk denendi ama o alan oyunda bazi durumlarda doluyor.
 */
const MIN_HEIGHT_PERCENT = 19;
/**
 * Ekranin ustundeki ag bilgisi (FPS / ping) alani; serit bunun altinda
 * kalir.
 */
const TOP_RESERVED_PERCENT = 7;
const MIN_OPACITY_PERCENT = 15;
const MAX_OPACITY_PERCENT = 100;
/** Zula paneli gibi ekranin sag kenarina yaslidir. */
const RIGHT_MARGIN = 0;

/**
 * Draft modu: 5 pozisyon sutunu, her sutunda en fazla 5 hero (ikon + puan).
 * Olculer 1080p icin; pencere ekran yuksekligiyle olceklenir (Dota'nin
 * HUD'u da oyle).
 */
const DRAFT_WIDTH = 196;
/** Sutunlar (~270) + ustteki kazanma ihtimali seridi (~22). */
const DRAFT_HEIGHT = 312;
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
 * @param {(mode: "draft"|"items") => boolean} options.isEnabled Mod acik mi
 * @param {() => { layout?: string, height?: number, opacity?: number }} [options.getItemConfig]
 *   Item seridinin dizilim / yukseklik (%) / opaklik (%) ayari
 */
function createOverlay(options) {
  const { logger, getState, isEnabled, getItemConfig } = options;
  const foreground = createForegroundWatcher({ logger });

  /** @type {BrowserWindow|null} */
  let window = null;
  /** @type {NodeJS.Timeout|null} */
  let timer = null;
  let lastPayload = "";
  let busy = false;

  /** Gosterilen mod ("items" | "draft"); konum ve boyut buna gore. */
  let mode = "items";
  /** Item seridinin dizilim ayari; degisince pencere yeniden konumlanir. */
  let itemConfig = readItemConfig();

  /**
   * Item seridinin ayarlari, gecerli araliga kirpilmis.
   * @returns {{ layout: string, height: number, opacity: number }}
   */
  function readItemConfig() {
    const raw = getItemConfig?.() || {};
    const layout = ITEM_LAYOUTS[raw.layout] ? raw.layout : "horizontal";
    const opacity = Number(raw.opacity);
    return {
      layout,
      height: Number(raw.height) || MIN_HEIGHT_PERCENT,
      opacity: Number.isFinite(opacity)
        ? Math.min(MAX_OPACITY_PERCENT, Math.max(MIN_OPACITY_PERCENT, opacity))
        : 75,
    };
  }

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
    const size = ITEM_LAYOUTS[itemConfig.layout];
    // Alt sinir Zula'nin ustu, ust sinir ag bilgisi alaninin alti.
    const maxPercent =
      100 - TOP_RESERVED_PERCENT - (size.height / area.height) * 100;
    const percent = Math.min(
      maxPercent,
      Math.max(MIN_HEIGHT_PERCENT, itemConfig.height),
    );
    return {
      x: Math.round(area.x + area.width - size.width - RIGHT_MARGIN),
      y: Math.round(area.y + area.height * (1 - percent / 100) - size.height),
      width: size.width,
      height: size.height,
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
      if (!isEnabled("draft") && !isEnabled("items")) {
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
      if (!state?.active || !hasContent || !isEnabled(nextMode)) {
        hide();
        return;
      }

      const target = ensureWindow();
      const nextConfig = readItemConfig();
      const modeChanged =
        nextMode !== mode ||
        (nextMode === "items" &&
          (nextConfig.layout !== itemConfig.layout ||
            nextConfig.height !== itemConfig.height));
      mode = nextMode;
      itemConfig = nextConfig;
      const payload = JSON.stringify({
        mode,
        hero: state.hero,
        items: state.items,
        roles: state.roles,
        winChance: state.winChance || null,
        layout: itemConfig.layout,
        opacity: itemConfig.opacity,
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
