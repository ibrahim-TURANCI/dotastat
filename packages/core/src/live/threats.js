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
 * Satirlarin tehdit AGIRLIGI: hero basina 1, net worth biliniyorsa takim
 * ortalamasina oranla olceklenir.
 *
 * Tehdit var/yok diye bakmak 0/10 giden bir rakiple oyunu tasiyan rakibi ayni
 * kefeye koyuyordu. Net worth yalnizca izleme/GSI verisinde geliyor;
 * gelmeyen satir notr (1) sayilir, tahmin uydurulmaz.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Map<Record<string, any>, number>}
 */
export function rowWeights(rows) {
  const worths = rows
    .map((row) => Number(row?.netWorth) || 0)
    .filter((value) => value > 0);
  const average = worths.length
    ? worths.reduce((sum, value) => sum + value, 0) / worths.length
    : 0;
  return new Map(
    rows.map((row) => {
      const worth = Number(row?.netWorth) || 0;
      return [row, average && worth ? worth / average : 1];
    }),
  );
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
 *   minHeroes: number,
 *   planOnly: boolean,
 *   answerHeroes: string[],
 *   answerReason: string,
 *   weight: number
 * }>}
 */
export function detectThreats(rows, overrides = {}) {
  /** @type {Map<string, Set<string>>} tehdit -> onu tasiyan hero'lar */
  const found = new Map();
  /** @type {Map<string, number>} tehdit -> toplam agirlik */
  const weights = new Map();
  const list = (rows || []).filter(Boolean);
  const weightOf = rowWeights(list);

  for (const row of list) {
    const hero = normalizeHeroKey(row?.hero);
    if (!hero) {
      continue;
    }
    for (const key of heroThreats(hero, overrides)) {
      if (!found.has(key)) {
        found.set(key, new Set());
      }
      found.get(key).add(hero);
      weights.set(key, (weights.get(key) || 0) + weightOf.get(row));
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
    // Takim onerisinde plansiz itemi "Duruma göre"ye dusurme; pick sirasinda
    // one cikarilacak hero'lar (bkz. data/hero-traits.js).
    planOnly: Boolean(threat.planOnly),
    answerHeroes: (threat.answerHeroes || [])
      .map(normalizeHeroKey)
      .filter(Boolean),
    answerReason: String(threat.answerReason || threat.reason),
    // Tasiyan hero sayisi (net worth biliniyorsa guce gore olceklenmis).
    // Oneri onceligi buna bakar; ekrandaki tehdit sirasi degismez.
    weight: Math.round((weights.get(threat.key) || 0) * 100) / 100,
  }));
}

/**
 * Tehditlerden item -> gerekce eslesmesi.
 *
 * Bir item birden fazla tehdide cevap verebilir (BKB hem buyusel hasara hem
 * hedefli buyuye); hepsi toplanir ki gerekce eksik kalmasin. Her itemin
 * listesi AGIRLIGA gore siralidir: gerekcede en guclu tehdit yazilir.
 *
 * @param {ReturnType<typeof detectThreats>} threats
 * @returns {Map<string, Array<{ key: string, label: string, reason: string, heroes: string[], weight: number }>>}
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
        weight: Number(threat.weight) || 0,
      });
    }
  }
  for (const list of answers.values()) {
    list.sort((a, b) => b.weight - a.weight);
  }
  return answers;
}

export { THREATS, TRAIT_BY_KEY as THREAT_BY_KEY, TRAIT_KEYS as THREAT_KEYS };
