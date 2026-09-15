/**
 * Hero ve item arama.
 *
 * NEDEN BURADA: "Tavsiyeleri yonet" ekraninda hero ve item eklerken TAM adi
 * yazmak gerekiyordu (`black_king_bar`, `keeper_of_the_light`). Kimse item
 * anahtarlarini ezbere bilmiyor ve bir harf hatasi kaydi sessizce dusuruyordu.
 *
 * Eslestirme oyundaki dukkan aramasi gibi davranir: birkac harf yeter, baslangic
 * eslesmesi one gelir ve KISALTMA da calisir — "bkb" yazinca Black King Bar
 * cikar. Bu alan bilgisi (takma adlar, gorunen ad ile ic anahtarin ayrilmasi)
 * cekirdekte duruyor ki arayuz ile motor ayni seyi anlasin.
 */

import itemIds from "../data/item-ids.js";
import retiredItems from "../data/retired-items.js";
import { heroDisplayName, normalizeHeroKey } from "./hero-names.js";
import heroOverrides from "../data/hero-overrides.js";
import { itemDisplayName } from "../live/item-advice.js";

/** Varsayilan sonuc sayisi; acilir liste bundan uzun olursa taranmaz olur. */
const DEFAULT_LIMIT = 8;

/**
 * Dukkanda satilmayan, plana giremeyecek anahtarlar.
 *
 * Tabloda tarif, jeton ve etkinlik esyalari da duruyor. Bunlari listelemek
 * aramayi kirletir: "to" yazan biri Tome of Knowledge yerine bes tane jeton
 * gorur.
 */
const NON_PURCHASABLE = /^(recipe|tier\d_token|ofrenda|foragers_|famango)/;

/**
 * Arama icin sadelestirilmis metin: yalnizca harf ve rakam.
 *
 * Bosluk ve kesme isareti atilir ki "eul's" ile "euls", "keeper of the light"
 * ile "keeperofthelight" ayni sey sayilsin.
 *
 * @param {unknown} value
 * @returns {string}
 */
function flatten(value) {
  return String(value || "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Gorunen adin bas harfleri: "Black King Bar" -> "bkb".
 *
 * Kesme isareti AYIRICI DEGIL: "Nature's Prophet" iki kelime sayilir ve "np"
 * verir. Ayirici olsaydi "nsp" cikardi — kimsenin yazmayacagi bir kisaltma.
 *
 * @param {string} name
 * @returns {string}
 */
function initials(name) {
  return String(name || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toLocaleLowerCase("en");
}

/**
 * Bir adayin sorguya UYGUNLUK puani. Dusuk daha iyi; `null` eslesmedi demek.
 *
 * Sira bilincli: once gorunen adin basi, sonra kisaltma, sonra ad icinde
 * gecmesi, en sonda ic anahtar. Kullanici gordugu adi yaziyor; ic anahtar
 * yalnizca son care.
 *
 * @param {{ key: string, name: string }} row
 * @param {string} needle Sadelestirilmis sorgu
 * @returns {number|null}
 */
function score(row, needle) {
  const name = flatten(row.name);
  const key = flatten(row.key);

  if (name.startsWith(needle)) {
    return 0;
  }
  if (initials(row.name).startsWith(needle)) {
    return 1;
  }
  if (key.startsWith(needle)) {
    return 2;
  }
  if (name.includes(needle)) {
    return 3;
  }
  if (key.includes(needle)) {
    return 4;
  }
  return null;
}

/**
 * Adaylari sorguya gore siralar.
 *
 * @param {Array<{ key: string, name: string }>} rows
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{ key: string, name: string }>}
 */
function rank(rows, query, limit) {
  const needle = flatten(query);
  if (!needle) {
    // Sorgu bossa liste bastan gosterilir; bos bir acilir kutu "sonuc yok" gibi
    // okunuyor ve kullanici yazmaya devam etmiyor.
    return rows.slice(0, limit);
  }

  return rows
    .map((row) => ({ row, rank: score(row, needle) }))
    .filter((entry) => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.row.name.length - b.row.name.length ||
        a.row.name.localeCompare(b.row.name, "en"),
    )
    .slice(0, limit)
    .map((entry) => entry.row);
}

/** Tum hero'lar, bir kez kurulur. */
const HERO_ROWS = Object.keys(heroOverrides)
  .map((key) => ({ key, name: heroDisplayName(key) || key }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

/** Dukkanda bulunabilecek tum itemler, bir kez kurulur. */
const ITEM_ROWS = (() => {
  const seen = new Set();
  const rows = [];
  for (const row of Object.values(itemIds || {})) {
    const key = String(row?.key || "");
    if (
      !key ||
      seen.has(key) ||
      NON_PURCHASABLE.test(key) ||
      retiredItems[key]
    ) {
      continue;
    }
    seen.add(key);
    rows.push({ key, name: itemDisplayName(key) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
})();

/**
 * Hero arar.
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{ key: string, name: string }>}
 */
export function searchHeroes(query, limit = DEFAULT_LIMIT) {
  const rows = rank(HERO_ROWS, query, limit);

  // Toplulukta yerlesmis kisaltmalar (`pa`, `qop`, `wr`) zaten hero anahtari
  // cozumleyicisinde tanimli; sirf ad eslesmesine bakmak onlari listenin
  // ortasina dusuruyordu. Tam eslesen kisaltma varsa basa alinir.
  const exact = exactHeroKey(query);
  if (!exact || rows[0]?.key === exact) {
    return rows;
  }
  const row = HERO_ROWS.find((entry) => entry.key === exact);
  if (!row) {
    return rows;
  }
  return [row, ...rows.filter((entry) => entry.key !== exact)].slice(0, limit);
}

/**
 * Item arar.
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{ key: string, name: string }>}
 */
export function searchItems(query, limit = DEFAULT_LIMIT) {
  return rank(ITEM_ROWS, query, limit);
}

/**
 * Yazilan metnin TAM olarak karsiladigi hero anahtari (varsa).
 *
 * Kullanici listeden secmeden Enter'a bastiginda kullanilir: yazdigi sey zaten
 * gecerli bir anahtarsa kabul edilir.
 *
 * @param {string} query
 * @returns {string}
 */
export function exactHeroKey(query) {
  const key = normalizeHeroKey(query);
  return heroOverrides[key] ? key : "";
}

export { HERO_ROWS, ITEM_ROWS };
