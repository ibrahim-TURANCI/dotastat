/**
 * Paketleme oncesi hazirlik.
 *
 * 1. `release/` klasorunu TAMAMEN siler. Boylece klasorde her zaman yalnizca
 *    en son surumun kurulum dosyasi kalir; eski surumler yer kaplamaz.
 * 2. Web arayuzunu derler ve ciktisini `packages/desktop/web` icine kopyalar
 *    (Electron penceresi bu dosyalari yerel sunucudan servis eder).
 * 3. Ikonlar yoksa uretir.
 *
 * Kullanim: npm run prebuild  (dist/pack scriptleri otomatik cagirir)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const webDist = path.join(repoRoot, "packages", "web", "dist");
const webTarget = path.join(desktopRoot, "web");
const releaseDir = path.join(desktopRoot, "release");
const buildIcon = path.join(desktopRoot, "build", "icon.ico");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * @param {string} label
 * @param {string[]} args
 */
function run(label, args) {
  console.log("> " + label);
  // Windows'ta `npm.cmd` bir toplu is dosyasidir; Node 24 bunu kabuk olmadan
  // calistirmayi reddediyor (EINVAL). Bu yuzden kabuk uzerinden cagriliyor.
  execFileSync(npmCommand, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/**
 * @param {string} target
 */
function removeIfExists(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

// 1. Eski cikti temizligi -----------------------------------------------------
console.log("Eski paketleme ciktilari siliniyor...");
removeIfExists(releaseDir);
removeIfExists(webTarget);

// 2. Ikonlar ------------------------------------------------------------------
if (!fs.existsSync(buildIcon)) {
  console.log("Ikonlar bulunamadi, uretiliyor...");
  execFileSync(process.execPath, [path.join(here, "generate-icons.mjs")], {
    cwd: desktopRoot,
    stdio: "inherit",
  });
}

// 3. Web arayuzu --------------------------------------------------------------
run("web derleniyor", ["run", "build:web"]);

if (!fs.existsSync(webDist)) {
  console.error("Web ciktisi bulunamadi: " + webDist);
  process.exit(1);
}

fs.cpSync(webDist, webTarget, { recursive: true });
console.log("Web ciktisi kopyalandi -> packages/desktop/web");

// 4. Site adresini pakete goem ------------------------------------------------
//
// Kurulumu indiren arkadasin ayarlara elle site adresi girmesi gerekmesin diye
// `DOTASTAT_CLOUD_URL` derleme aninda package.json'a yazilir; uygulama bunu
// varsayilan olarak okur (bkz. server/settings.js). Kullanici isterse
// ayarlardan degistirebilir.
const bakedCloudUrl = String(process.env.DOTASTAT_CLOUD_URL || "").trim();
if (bakedCloudUrl) {
  const pkgPath = path.join(desktopRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.dotastat = { ...(pkg.dotastat || {}), cloudUrl: bakedCloudUrl };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log("Site adresi pakete yazildi -> " + bakedCloudUrl);
} else {
  console.log(
    "DOTASTAT_CLOUD_URL tanimli degil; site adresi ayarlardan girilecek.",
  );
}

console.log("Hazirlik tamam.");
