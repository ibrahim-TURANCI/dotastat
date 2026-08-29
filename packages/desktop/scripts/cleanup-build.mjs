/**
 * Paketleme sonrasi temizlik.
 *
 * electron-builder, kurulum dosyasini uretirken yan urun olarak birkac yuz
 * megabaytlik ara klasor birakir. Kurulum dosyasi hazir olduktan sonra bunlara
 * ihtiyac yoktur; `release/` klasorunde YALNIZCA su anki surumun kurulum
 * dosyasi (ve guncelleme icin gereken kucuk dosyalar) kalir.
 *
 * Silinenler:
 *   release/win-unpacked/         (paketlenmemis uygulama, ~250 MB)
 *   release/builder-debug.yml     (derleme gunlugu)
 *   release/.icon-ico/            (ara ikon ciktilari)
 *   release/DotaStat-Setup-*.exe  (SU ANKI surum haric — eski surumler)
 *
 * Korunanlar:
 *   release/DotaStat-Setup-<surum>.exe
 *   release/DotaStat-Setup-<surum>.exe.blockmap  (fark tabanli guncelleme)
 *   release/latest.yml                            (electron-updater)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const releaseDir = path.join(desktopRoot, "release");

if (!fs.existsSync(releaseDir)) {
  console.log("release/ klasoru yok, temizlenecek bir sey bulunamadi.");
  process.exit(0);
}

const version = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
).version;

const keepPrefix = "DotaStat-Setup-" + version;
const removeDirs = ["win-unpacked", ".icon-ico", ".icon-set"];
const removeFiles = ["builder-debug.yml"];

let freed = 0;

/**
 * @param {string} target
 * @returns {number} silinen bayt
 */
function sizeOf(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    return stat.size;
  }
  return fs
    .readdirSync(target)
    .reduce((total, name) => total + sizeOf(path.join(target, name)), 0);
}

/**
 * @param {string} target
 */
function remove(target) {
  if (!fs.existsSync(target)) {
    return;
  }
  freed += sizeOf(target);
  fs.rmSync(target, { recursive: true, force: true });
  console.log("  silindi: " + path.relative(desktopRoot, target));
}

console.log("Paketleme artiklari temizleniyor (korunan surum: " + version + ")");

for (const name of removeDirs) {
  remove(path.join(releaseDir, name));
}
for (const name of removeFiles) {
  remove(path.join(releaseDir, name));
}

// Ayni klasorde kalmis eski surum kurulumlari.
for (const name of fs.readdirSync(releaseDir)) {
  const isInstaller = /^DotaStat-Setup-.+\.exe(\.blockmap)?$/.test(name);
  if (isInstaller && !name.startsWith(keepPrefix)) {
    remove(path.join(releaseDir, name));
  }
}

console.log(
  "Kazanilan alan: " + (freed / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB",
);
console.log("Kalan dosyalar:");
for (const name of fs.readdirSync(releaseDir)) {
  const bytes = sizeOf(path.join(releaseDir, name));
  console.log(
    "  " + name + "  (" + (bytes / (1024 * 1024)).toFixed(1) + " MB)",
  );
}
