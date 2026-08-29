/**
 * Uygulama ve tepsi (tray) ikonlarini uretir.
 *
 * Ciktilar:
 *   build/icon.ico       - kurulum + pencere ikonu (16..256 px, cok katmanli)
 *   build/icon.png       - 512 px kaynak
 *   resources/tray.ico   - tepsi ikonu (16/20/24/32 px, DPI olceklerini kapsar)
 *   resources/tray.png   - tepsi yedek gorseli (32 px)
 *
 * Tepsi ikonunun BOS gorunmemesi icin iki sey onemli:
 *   1. Ikon `extraResources` ile asar DISINA kopyalanir; Electron'un
 *      nativeImage.createFromPath'i asar icindeki dosyalarda guvenilir degil.
 *   2. .ico icinde birden fazla boyut bulunur; Windows olcekli ekranlarda
 *      16 px'e zorla kucultulmus tek katmanli ikonu bos cizebiliyor.
 *
 * Kullanim: npm run icons  (packages/desktop icinde)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const buildDir = path.join(desktopRoot, "build");
const resourcesDir = path.join(desktopRoot, "resources");

const require = createRequire(import.meta.url);

/** @type {import("sharp")} */
let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error(
    "sharp bulunamadi. Once `npm install --save-dev sharp` calistir.",
  );
  process.exit(1);
}

/** Uygulama ikonu — favicon ile ayni tasarim. */
const APP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2ea7ff"/>
      <stop offset="1" stop-color="#28c76f"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="#0b1420"/>
  <path d="M14 44V20h10c8 0 13 4 13 12s-5 12-13 12H14zm8-6h2c4 0 6-2 6-6s-2-6-6-6h-2v12z" fill="url(#g)"/>
  <rect x="42" y="20" width="6" height="24" rx="3" fill="url(#g)"/>
  <rect x="42" y="20" width="6" height="9" rx="3" fill="#eaf3ff" opacity=".85"/>
</svg>`;

/**
 * Tepsi ikonu ayri cizilir: 16 px'te okunabilmesi icin cerceve yok, sekil
 * daha kalin ve kontrast yuksek. Kucuk boyutta ince cizgiler kayboluyor.
 */
const TRAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7fd0ff"/>
      <stop offset="1" stop-color="#4ee39a"/>
    </linearGradient>
  </defs>
  <path d="M4 27V5h9c8.5 0 13.5 4.2 13.5 11S21.5 27 13 27H4zm7-5.5h2.2c4.4 0 6.8-2.1 6.8-5.5s-2.4-5.5-6.8-5.5H11v11z" fill="url(#t)"/>
</svg>`;

const ICO_SIZES_APP = [16, 24, 32, 48, 64, 128, 256];
const ICO_SIZES_TRAY = [16, 20, 24, 32, 40, 48];

/**
 * PNG tamponlarindan .ico dosyasi olusturur.
 *
 * ICO basligi: 6 bayt dosya basligi + her goruntu icin 16 bayt dizin girdisi.
 * Vista ve sonrasi PNG sikistirilmis katmanlari destekler, bu yuzden PNG'ler
 * oldugu gibi gomulur.
 *
 * @param {Array<{ size: number, data: Buffer }>} images
 * @returns {Buffer}
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // ayrilmis
  header.writeUInt16LE(1, 2); // tur: 1 = ikon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const base = index * 16;
    // 256 px, ICO dizininde 0 olarak yazilir.
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, base + 0);
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, base + 1);
    directory.writeUInt8(0, base + 2); // palet rengi yok
    directory.writeUInt8(0, base + 3); // ayrilmis
    directory.writeUInt16LE(1, base + 4); // renk duzlemi
    directory.writeUInt16LE(32, base + 6); // bit derinligi
    directory.writeUInt32LE(image.data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((row) => row.data)]);
}

/**
 * @param {string} svg
 * @param {number[]} sizes
 * @returns {Promise<Array<{ size: number, data: Buffer }>>}
 */
async function renderSizes(svg, sizes) {
  const source = Buffer.from(svg, "utf8");
  return Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await sharp(source, { density: 384 })
        .resize(size, size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer(),
    })),
  );
}

async function main() {
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const appImages = await renderSizes(APP_SVG, ICO_SIZES_APP);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), buildIco(appImages));
  fs.writeFileSync(
    path.join(buildDir, "icon.png"),
    (await renderSizes(APP_SVG, [512]))[0].data,
  );

  const trayImages = await renderSizes(TRAY_SVG, ICO_SIZES_TRAY);
  fs.writeFileSync(path.join(resourcesDir, "tray.ico"), buildIco(trayImages));
  fs.writeFileSync(
    path.join(resourcesDir, "tray.png"),
    trayImages.find((row) => row.size === 32).data,
  );
  // Pencere ikonu da asar disinda dursun (tepsi ile ayni sebep).
  fs.writeFileSync(path.join(resourcesDir, "icon.ico"), buildIco(appImages));

  console.log("Ikonlar uretildi:");
  console.log("  build/icon.ico      (" + ICO_SIZES_APP.join(", ") + ")");
  console.log("  build/icon.png      (512)");
  console.log("  resources/tray.ico  (" + ICO_SIZES_TRAY.join(", ") + ")");
  console.log("  resources/tray.png  (32)");
  console.log("  resources/icon.ico");
}

main().catch((error) => {
  console.error("Ikon uretimi basarisiz:", error);
  process.exit(1);
});
