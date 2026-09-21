/**
 * `packages/core/src/data/item-costs.js` uretici.
 *
 * NE URETIR: item anahtari -> altin maliyeti.
 *
 * NE ICIN GEREKLI: envanteri GORUNMEYEN hero'lar icin tahmini envanter
 * kuruluyor (bkz. live/predicted-items.js) ve "bu hero simdiye kadar planinin
 * neresine geldi" sorusu maliyet olmadan cevaplanamiyor. Hero'nun cekirdek
 * plani ALIM SIRASINDA DEGIL, pro maclardaki kullanim siklikligina gore
 * siralidir: Riki'nin listesi Skadi ile, Crystal Maiden'inki Mekansm ile
 * basliyor. Listenin ilk N itemini almis saymak, 8. dakikada Riki'nin elinde
 * Skadi var demek olurdu.
 *
 * Maliyet siralamasi bu sorunu cozer: ucuz item once alinir. Kusursuz degil
 * (bazi hero Blink'i Maelstrom'dan once alir) ama "hangi itemler simdiye kadar
 * alinmis olabilir" sorusuna verilebilecek en ucuz dogru cevap bu.
 *
 * CALISTIRMA
 *   node scripts/build-item-costs.mjs
 *
 * Cikti dosyasi depoya COMMITLENIR: uretici aga bagli, uygulama degil.
 * Yeni bir yama fiyat degistirdiginde tekrar calistirmak yeterli.
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
  "item-costs.js",
);

const OPENDOTA_ITEMS =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json";

/**
 * @param {string} url
 * @param {string} label
 */
async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(label + " okunamadi: HTTP " + response.status);
  }
  return response.json();
}

const items = await fetchJson(OPENDOTA_ITEMS, "item tablosu");

/** @type {Array<[string, number]>} */
const rows = [];
for (const [key, item] of Object.entries(items)) {
  const cost = Number(item?.cost || 0);
  // Fiyatsiz kayitlar (recipe yerine gecen kabuklar, kaldirilmis itemler)
  // tabloya girmez: sifir maliyet "bedava" demek olurdu ve tahmini envanterde
  // hepsi en basa yigilirdi.
  if (cost > 0) {
    rows.push([String(key), cost]);
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]));

const body = rows.map(([key, cost]) => `  ${key}: ${cost},`).join("\n");

const output = `/**
 * Item altin maliyetleri (URETILMIS VERI — elle duzenlemeyin).
 *
 * Uretici: scripts/build-item-costs.mjs
 * Kaynak: OpenDota dotaconstants item tablosu
 *
 * Tahmini envanter bu tabloya dayanir: hero'nun cekirdek plani alim sirasinda
 * degil kullanim sikligina gore sirali oldugu icin, "simdiye kadar ne almis
 * olabilir" sorusu maliyete gore cevaplanir (bkz. live/predicted-items.js).
 *
 * JSON yerine ES modulu olarak tutulur: hem Node (Netlify Functions, Electron)
 * hem tarayici (Vite) tarafinda ek yapilandirma olmadan import edilebilsin diye.
 */
export default {
${body}
};
`;

fs.writeFileSync(OUTPUT, output);
console.log(rows.length + " item maliyeti yazildi -> " + OUTPUT);
