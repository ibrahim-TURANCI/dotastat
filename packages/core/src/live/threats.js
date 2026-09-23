/**
 * Rakip kompozisyonundaki TEHDITLER ve onlara cevap veren itemler.
 *
 * NE ISE YARAR: "rakipte gorunmez hero var" ile "Essence Distiller al"
 * arasindaki baglanti. Tavsiye motoru hem tek oyuncu satirinda hem takim
 * onerilerinde bu tabloyu kullanir, boylece iki yerde ayni gerekce gorunur.
 *
 * TEHDIT TANIMLARI SABIT, HERO LISTELERI DEGIL
 * --------------------------------------------
 * Hangi ozelligin hangi itemi cagirdigi oyunun kurali: gorunmezlige dedektor
 * alinir, tek hedefli ultiye Linken's. Ama hangi hero'nun o ozelligi TASIDIGI
 * yoruma acik ve yamayla degisiyor — eskiden liste bu dosyada kilitliydi ve
 * "Kez de gorunmez oluyor" demenin tek yolu depoyu duzenlemekti.
 *
 * Artik tohum veri `data/hero-traits.js`'te durur, kullanici "Tavsiyeleri
 * yonet > hero > Özellikler" kutucuklariyla uzerine yazar ve kayit hero
 * katalogunda `traits` alani olarak tutulur. Bu yuzden asagidaki fonksiyonlar
 * hero listesini KATALOGDAN okur; tohuma dogrudan bakmak, kullanicinin
 * isaretledigi kutucugu yok saymak olurdu.
 */

import { heroRecord } from "../heroes/hero-catalog.js";
import { normalizeHeroKey } from "../heroes/hero-names.js";
import {
  HERO_TRAITS,
  TRAIT_BY_KEY,
  TRAIT_KEYS,
  heroTraitSeed,
} from "../heroes/hero-traits.js";
import { normalizeItemKey } from "./item-keys.js";

/**
 * Tehdit tanimlari (`data/hero-traits.js`).
 *
 * `heroes`  : bu tehdidi TASIYAN rakip hero'lar (TOHUM — kullanici ezebilir)
 * `items`   : tehdide cevap veren itemler (tercih sirasiyla)
 * `label`   : ekranda gorunen kisa ad
 * `tooltip` : kutucugun uzerine gelince gorunen "ne onerilir" aciklamasi
 * `reason`  : oneri kutusunda gorunen gerekce kalibi
 */
const THREATS = HERO_TRAITS;

/**
 * Bir hero'nun ozellikleri: tohum + kullanicinin duzenlemesi.
 *
 * @param {string} hero
 * @param {Record<string, Record<string, any>>} [overrides] hero -> duzenleme
 * @returns {string[]}
 */
export function heroThreats(hero, overrides = {}) {
  const key = normalizeHeroKey(hero);
  if (!key) {
    return [];
  }
  // Katalogda olmayan bir hero (eski kayit, yeni yama) tohumuna duser; tehdit
  // uretmeyi tamamen birakmak onerileri sessizce eksiltirdi.
  const record = heroRecord(key, overrides?.[key] || null);
  return record ? [...(record.traits || [])] : heroTraitSeed(key);
}

/**
 * Bir takimin TASIDIGI tehditler.
 *
 * @param {Array<Record<string, any>>} rows Rakip satirlari
 * @param {Record<string, Record<string, any>>} [overrides] hero -> duzenleme
 * @returns {Array<{
 *   key: string,
 *   label: string,
 *   tooltip: string,
 *   reason: string,
 *   items: string[],
 *   heroes: string[],
 *   personal: boolean,
 *   until: number|null,
 *   roles: string[]|null,
 *   minHeroes: number
 * }>}
 */
export function detectThreats(rows, overrides = {}) {
  /** @type {Map<string, Set<string>>} tehdit -> onu tasiyan hero'lar */
  const found = new Map();

  for (const row of rows || []) {
    const hero = normalizeHeroKey(row?.hero);
    if (!hero) {
      continue;
    }
    for (const key of heroThreats(hero, overrides)) {
      if (!found.has(key)) {
        found.set(key, new Set());
      }
      found.get(key).add(hero);
    }
  }

  // Sira tanim sirasiyla ayni tutulur: ekranda tehditler her yoklamada yer
  // degistirirse liste okunamaz hale gelir.
  return THREATS.filter((threat) => found.has(threat.key)).map((threat) => ({
    key: threat.key,
    label: threat.label,
    tooltip: threat.tooltip,
    reason: threat.reason,
    items: threat.items.map(normalizeItemKey),
    heroes: [...found.get(threat.key)],
    // Kisisel erken cevap alanlari (bkz. data/hero-traits.js). Tanimda yoksa
    // tehdit eskisi gibi davranir.
    personal: Boolean(threat.personal),
    until: Number.isFinite(threat.until) ? threat.until : null,
    roles: Array.isArray(threat.roles) ? [...threat.roles] : null,
    minHeroes: Number(threat.minHeroes) || 0,
  }));
}

/**
 * Tehditlerden item -> gerekce eslesmesi.
 *
 * Bir item birden fazla tehdide cevap verebilir (BKB hem buyusel hasara hem
 * hedefli buyuye); hepsi toplanir ki gerekce eksik kalmasin.
 *
 * @param {ReturnType<typeof detectThreats>} threats
 * @returns {Map<string, Array<{ key: string, label: string, reason: string, heroes: string[] }>>}
 */
export function threatAnswers(threats) {
  /** @type {Map<string, Array<Record<string, any>>>} */
  const answers = new Map();
  for (const threat of threats || []) {
    for (const item of threat.items) {
      if (!answers.has(item)) {
        answers.set(item, []);
      }
      answers.get(item).push({
        key: threat.key,
        label: threat.label,
        reason: threat.reason,
        heroes: threat.heroes,
      });
    }
  }
  return answers;
}

export { THREATS, TRAIT_BY_KEY as THREAT_BY_KEY, TRAIT_KEYS as THREAT_KEYS };
