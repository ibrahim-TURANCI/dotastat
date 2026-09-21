/**
 * Hero ozellik tanimlari ve TOHUM eslesmesi.
 *
 * NEDEN AYRI BIR MODUL: ozellikleri iki taraf da okuyor —
 *
 *   hero-catalog.js  kaydin `traits` alaninin baslangic degeri icin
 *   live/threats.js  sahadaki tehditleri cikarmak icin
 *
 * Ikisi de katalogtan gecmek zorunda (kullanicinin isaretledigi kutucuk
 * tohumu ezer) ve `threats.js` bu yuzden `hero-catalog.js`'i import ediyor.
 * Tohum tablo da orada dursaydi iki modul birbirini import ederdi. Bu dosya
 * yalnizca veriyi ve saf yardimcilari tasir: hicbir seyi import etmez ki
 * dongunun ortasinda kalmasin.
 */

import heroTraitDefs from "../data/hero-traits.js";
import { normalizeHeroKey } from "./hero-names.js";

/** Ozellik tanimlari; ekranda ve rozetlerde gorunen sira budur. */
export const HERO_TRAITS = heroTraitDefs;

/** Gecerli ozellik anahtarlari (tanim sirasiyla). */
export const TRAIT_KEYS = HERO_TRAITS.map((trait) => trait.key);

/** anahtar -> tanim. */
export const TRAIT_BY_KEY = new Map(
  HERO_TRAITS.map((trait) => [trait.key, trait]),
);

/** Ekranda gorunen adlar (kutucuk etiketi ve tehdit rozeti ayni adi kullanir). */
export const TRAIT_LABELS = Object.fromEntries(
  HERO_TRAITS.map((trait) => [trait.key, trait.label]),
);

/** Kutucugun uzerine gelince gorunen "ne onerilir" aciklamasi. */
export const TRAIT_TOOLTIPS = Object.fromEntries(
  HERO_TRAITS.map((trait) => [trait.key, trait.tooltip]),
);

/** hero -> tohum ozellik anahtarlari. Bir kez kurulur. */
const SEED_BY_HERO = (() => {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const trait of HERO_TRAITS) {
    for (const hero of trait.heroes || []) {
      const key = normalizeHeroKey(hero);
      if (!key) {
        continue;
      }
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(trait.key);
    }
  }
  return map;
})();

/**
 * Bir hero'nun TOHUM ozellikleri (kullanici duzenlemesi OLMADAN).
 *
 * @param {unknown} hero
 * @returns {string[]}
 */
export function heroTraitSeed(hero) {
  return [...(SEED_BY_HERO.get(normalizeHeroKey(hero)) || [])];
}

/**
 * Serbest bir listeden gecerli ozellik anahtarlari.
 *
 * Sira TANIM SIRASINA cekilir: kayitta kutucuklarin tiklanma sirasi dursaydi
 * ayni ozellik kumesi iki hero'da farkli siralanir ve ekrandaki rozetler yer
 * degistirirdi.
 *
 * @param {unknown} list
 * @returns {string[]}
 */
export function normalizeTraitList(list) {
  const wanted = new Set(
    (Array.isArray(list) ? list : []).map((raw) =>
      String(raw || "")
        .trim()
        .toLowerCase(),
    ),
  );
  return TRAIT_KEYS.filter((key) => wanted.has(key));
}
