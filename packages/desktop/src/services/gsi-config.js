/**
 * Dota 2 Game State Integration yapilandirmasini kurar.
 *
 * Dota, `.../dota 2 beta/game/dota/cfg/gamestate_integration/` altindaki
 * `gamestate_integration_*.cfg` dosyalarini okur ve orada yazan adrese oyun
 * durumunu POST eder. Bu servis o dosyayi dogru klasore yazar.
 *
 * Not: Dosya yazildiktan sonra Dota'nin YENIDEN BASLATILMASI gerekir.
 */

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILE_NAME = "gamestate_integration_dotastat.cfg";

/** Steam kurulumunun bulunabilecegi tipik yerler. */
const COMMON_STEAM_ROOTS = [
  "C:/Program Files (x86)/Steam",
  "C:/Program Files/Steam",
  "D:/Steam",
  "D:/SteamLibrary",
  "E:/Steam",
  "E:/SteamLibrary",
  "F:/SteamLibrary",
];

const DOTA_SUFFIX = "steamapps/common/dota 2 beta/game/dota/cfg";

/**
 * @param {number} port
 * @returns {string}
 */
function buildConfigContent(port) {
  return [
    '"DotaStat Integration Configuration"',
    "{",
    '  "uri"               "http://127.0.0.1:' + port + '/gsi"',
    '  "timeout"           "5.0"',
    '  "buffer"            "0.1"',
    '  "throttle"          "0.1"',
    '  "heartbeat"         "30.0"',
    '  "data"',
    "  {",
    '    "provider"                 "1"',
    '    "map"                      "1"',
    '    "player"                   "1"',
    '    "hero"                     "1"',
    '    "abilities"                "1"',
    '    "items"                    "1"',
    '    "allplayers_id"            "1"',
    '    "allplayers_name"          "1"',
    '    "allplayers_hero"          "1"',
    '    "allplayers_level"         "1"',
    '    "allplayers_state"         "1"',
    '    "allplayers_match_stats"   "1"',
    '    "allplayers_items"         "1"',
    '    "allplayers_position"      "1"',
    '    "draft"                    "1"',
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * Dota'nin cfg klasorunu arar.
 * @returns {string} bulunamazsa ""
 */
function findDotaCfgDir() {
  for (const root of COMMON_STEAM_ROOTS) {
    const candidate = path.join(root, DOTA_SUFFIX).replace(/\\/g, "/");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Steam'in kutuphane klasorlerini libraryfolders.vdf uzerinden tarar.
  for (const root of COMMON_STEAM_ROOTS) {
    const vdf = path.join(root, "steamapps", "libraryfolders.vdf");
    if (!fs.existsSync(vdf)) {
      continue;
    }
    try {
      const text = fs.readFileSync(vdf, "utf8");
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) {
        const libraryRoot = match[1].replace(/\\\\/g, "/");
        const candidate = path
          .join(libraryRoot, DOTA_SUFFIX)
          .replace(/\\/g, "/");
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Okunamayan kutuphane dosyasi atlanir.
    }
  }

  return "";
}

/**
 * Yapilandirma dosyasini yazar.
 *
 * @param {{ port: number, cfgDir?: string }} options
 * @returns {{ ok: boolean, path?: string, error?: string, changed?: boolean }}
 */
function installGsiConfig(options) {
  const port = Number(options.port) || 3044;
  const cfgDir = options.cfgDir || findDotaCfgDir();

  if (!cfgDir) {
    return { ok: false, error: "dota-klasoru-bulunamadi" };
  }

  const targetDir = path.join(cfgDir, "gamestate_integration");
  const targetFile = path.join(targetDir, CONFIG_FILE_NAME);
  const content = buildConfigContent(port);

  try {
    fs.mkdirSync(targetDir, { recursive: true });

    // Icerik ayniysa dosyaya dokunulmaz (Dota'yi bosuna yeniden baslatma).
    if (fs.existsSync(targetFile)) {
      const existing = fs.readFileSync(targetFile, "utf8");
      if (existing === content) {
        return { ok: true, path: targetFile, changed: false };
      }
    }

    fs.writeFileSync(targetFile, content, "utf8");
    return { ok: true, path: targetFile, changed: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

module.exports = {
  buildConfigContent,
  findDotaCfgDir,
  installGsiConfig,
  CONFIG_FILE_NAME,
};
