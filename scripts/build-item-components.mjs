/**
 * `packages/core/src/data/item-components.js` uretici.
 *
 * NE URETIR: recipe ile yapilan item -> parca listesi.
 *
 * NE ICIN GEREKLI: tavsiye motoru pahali bir itemi dogrudan onermek yerine
 * once ara parcayi onerir (Manta yerine once Yasha; bkz.
 * live/item-progression.js). "Manta'nin ara parcasi ne" sorusu bu tablo
 * olmadan cevaplanamiyor. Ayni tablo "Manta'si olana Yasha onerme" kuralini
 * da besler: sahip olunan itemin parcalari da "elde var" sayilir.
 *
 * CALISTIRMA
 *   node scripts/build-item-components.mjs
 *
 * Cikti dosyasi depoya COMMITLENIR: uretici aga bagli, uygulama degil.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(
  ROOT,
  "packages",
  "core",
  "src",
  "data",
  "item-components.js",
);

const OPENDOTA_ITEMS =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json";

const response = await fetch(OPENDOTA_ITEMS);
if (!response.ok) {
  throw new Error("item tablosu okunamadi: HTTP " + response.status);
}
const items = await response.json();

/** @type {Array<[string, string[]]>} */
const rows = [];
for (const [key, item] of Object.entries(items)) {
  const components = Array.isArray(item?.components)
    ? item.components.filter(Boolean).map(String)
    : [];
  // Parcasiz kayitlar (temel itemler) tabloya girmez: "parcasi yok" zaten
  // tablodaki yoklukla ifade ediliyor.
  if (components.length && Number(item?.cost || 0) > 0) {
    rows.push([String(key), components]);
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]));

const body = rows
  .map(
    ([key, parts]) =>
      `  ${key}: [${parts.map((part) => JSON.stringify(part)).join(", ")}],`,
  )
  .join("\n");

const output = `/**
 * Item parcalari (URETILMIS VERI — elle duzenlemeyin).
 *
 * Uretici: scripts/build-item-components.mjs
 * Kaynak: OpenDota dotaconstants item tablosu
 *
 * Recipe parcasi listede yer almaz (dotaconstants onu ayri tutuyor). Kademeli
 * tavsiye bu tabloya dayanir (bkz. live/item-progression.js).
 *
 * JSON yerine ES modulu olarak tutulur: hem Node (Netlify Functions, Electron)
 * hem tarayici (Vite) tarafinda ek yapilandirma olmadan import edilebilsin diye.
 */
export default {
${body}
};
`;

fs.writeFileSync(OUTPUT, output);
console.log(rows.length + " item parca listesi yazildi -> " + OUTPUT);
