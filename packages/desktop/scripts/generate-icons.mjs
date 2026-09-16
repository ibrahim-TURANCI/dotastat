/**
 * Uygulama ve tepsi (tray) ikonlarini uretir.
 *
 * KAYNAK TEK BIR GORSEL: `build/icon-source.png`. Tum ciktilar ondan
 * olceklenir; boylece ikonu degistirmek dosyayi degistirip `npm run icons`
 * demekten ibaret. Eskiden tasarim bu dosyanin icinde SVG olarak gomuluydu ve
 * ikonu degistirmek icin kod duzenlemek gerekiyordu.
 *
 * Ciktilar:
 *   build/icon.ico       - kurulum + pencere ikonu (16..256 px, cok katmanli)
 *   build/icon.png       - 512 px kaynak
 *   resources/icon.ico   - pencere ikonu, asar DISINDA
 *   resources/tray.ico   - tepsi ikonu (16..48 px, DPI olceklerini kapsar)
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

/** Tum ciktilarin uretildigi kaynak gorsel. */
const SOURCE = path.join(buildDir, "icon-source.png");

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
 * Kaynagi verilen boyutlara olcekler.
 *
 * `fit: contain` ve saydam zemin: kaynak kare degilse ikon EZILMEZ, kisa
 * kenardan bosluk birakilir. Kare olmayan bir ikonu zorla kareye germek
 * Windows'ta gorunur sekilde bozuk duruyor.
 *
 * @param {Buffer} source
 * @param {number[]} sizes
 * @returns {Promise<Array<{ size: number, data: Buffer }>>}
 */
async function renderSizes(source, sizes) {
  return Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await sharp(source)
        .resize(size, size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer(),
    })),
  );
}

/**
 * Tepsi icin kaynagin BOSLUKLARI kirpilir.
 *
 * Tepsi ikonu 16 px cizilir ve kaynaktaki kenar boslugu o olcekte gorselin
 * yarisini yiyor — ikon "uzakta ve kucuk" duruyordu. Kirpma yalnizca tek
 * renk/saydam kenarlari atar, tasarima dokunmaz.
 *
 * Kirpilamazsa (kenarlar tek duze degilse) kaynak oldugu gibi kullanilir:
 * kirpma bir iyilestirme, on kosul degil.
 *
 * @param {Buffer} source
 * @returns {Promise<Buffer>}
 */
async function trimmed(source) {
  try {
    return await sharp(source).trim().png().toBuffer();
  } catch {
    return source;
  }
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error("Kaynak ikon bulunamadi: " + SOURCE);
    console.error(
      "Kullanmak istedigin gorseli bu yola PNG olarak koy (kare, en az 256 px).",
    );
    process.exit(1);
  }

  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const source = fs.readFileSync(SOURCE);
  const meta = await sharp(source).metadata();
  if (Math.min(meta.width || 0, meta.height || 0) < 256) {
    console.error(
      "Kaynak ikon cok kucuk (" +
        meta.width +
        "x" +
        meta.height +
        "). En az 256x256 olmali; kucuk kaynaktan buyutulen 256 px katmani bulanik cikar.",
    );
    process.exit(1);
  }

  const appImages = await renderSizes(source, ICO_SIZES_APP);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), buildIco(appImages));
  fs.writeFileSync(
    path.join(buildDir, "icon.png"),
    (await renderSizes(source, [512]))[0].data,
  );

  const trayImages = await renderSizes(await trimmed(source), ICO_SIZES_TRAY);
  fs.writeFileSync(path.join(resourcesDir, "tray.ico"), buildIco(trayImages));
  fs.writeFileSync(
    path.join(resourcesDir, "tray.png"),
    trayImages.find((row) => row.size === 32).data,
  );
  // Pencere ikonu da asar disinda dursun (tepsi ile ayni sebep).
  fs.writeFileSync(path.join(resourcesDir, "icon.ico"), buildIco(appImages));

  console.log("Ikonlar uretildi (kaynak: build/icon-source.png):");
  console.log("  build/icon.ico      (" + ICO_SIZES_APP.join(", ") + ")");
  console.log("  build/icon.png      (512)");
  console.log("  resources/icon.ico");
  console.log("  resources/tray.ico  (" + ICO_SIZES_TRAY.join(", ") + ")");
  console.log("  resources/tray.png  (32)");
}

main().catch((error) => {
  console.error("Ikon uretimi basarisiz:", error);
  process.exit(1);
});
