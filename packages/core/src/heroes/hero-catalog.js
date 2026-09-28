/**
 * Hero tavsiye katalogu: uretilmis tohum veri + kullanicinin elle duzenlemesi.
 *
 * NE ICIN VAR: canli mac motoru da ("bu hero ne alsin"), "Tavsiyeleri yonet"
 * ekrani da AYNI kaydi okur. Iki taraf ayri yerden okusaydi ekranda gorunen
 * liste ile motorun kullandigi liste birbirinden kayardi — kullanici bir item
 * ekler, oneri degismezdi.
 *
 * KAYIT SEKLI
 *   roleValues       0-100 sekiz eksen; takim radarinin ham girdisi
 *   laneRoles        pozisyonlar ("carry" | "mid" | "offlane" | "sup4" | "sup5")
 *   traits           hero'nun tasidigi ozellikler ("invisible", "regen"...);
 *                    rakip kompozisyonundan uretilen tehdit onerisini bu besler
 *   counterHeroes    bu hero'yu zorlayan heroler
 *   counterItems     bu hero'ya KARSI alinan itemler
 *   requiredItems    cekirdek item plani
 *   situationalItems duruma gore alinan itemler
 *   removedItems     bu hero'da HIC onerilmesin denenler
 *
 * TOHUM VERI degistirilmez; kullanicinin kaydi onun UZERINE biner ve yalnizca
 * yazdigi alanlari ezer. Boylece bir alani duzenlemek digerlerini silmez ve
 * "sifirla" kaydi silmekten ibaret kalir.
 *
 * TOHUM IKI KATMANDIR: uretilmis veri (data/hero-overrides.js) ve onun uzerine
 * binen elle tutulan varsayilanlar (data/hero-seed-overrides.js). Ikincisi,
 * ekranda yapilip kalici kilinmis duzenlemedir; "sifirla" oraya doner.
 */

import heroOverrides from "../data/hero-overrides.js";
import heroSeedOverrides from "../data/hero-seed-overrides.js";
import { isRetiredItem, normalizeItemKey } from "../live/item-keys.js";
import { normalizeHeroKey } from "./hero-names.js";
import { heroTraitSeed, normalizeTraitList } from "./hero-traits.js";

/** Radar eksenleri; ekranda gorunen sira budur. */
export const ROLE_VALUE_KEYS = [
  "carry",
  "support",
  "burst",
  "catch",
  "escape",
  "durability",
  "initiation",
  "push",
];

/** Eksenlerin Turkce adlari (radar, tablo ve avantaj listesi ayni adi kullanir). */
export const ROLE_VALUE_LABELS = {
  carry: "Taşıyıcı",
  support: "Destek",
  burst: "Ani Hasar",
  catch: "Yakalama",
  escape: "Kaçış",
  durability: "Dayanıklılık",
  initiation: "Tetikleyici",
  push: "İttirici",
};

/** Lane rolleri ve ekranda gorunen adlari. */
export const LANE_ROLES = ["carry", "mid", "offlane", "sup4", "sup5"];

export const LANE_ROLE_LABELS = {
  carry: "Carry",
  mid: "Mid",
  offlane: "Offlane",
  sup4: "Sup(4)",
  sup5: "Sup(5)",
};

/**
 * Lane rolu <-> pozisyon ("pos1".."pos5").
 *
 * Katalog lane rolu, oyuncu verisi ve draft ise pozisyon anahtari konusuyor.
 * Eslesme TEK yerde durur: draft'in "bu hero hangi pozisyona" sorusu ile canli
 * tavsiyenin "bu oyuncu hangi rolde" sorusu ayni cevabi vermeli.
 */
export const POSITION_BY_LANE_ROLE = {
  carry: "pos1",
  mid: "pos2",
  offlane: "pos3",
  sup4: "pos4",
  sup5: "pos5",
};

const LANE_ROLE_BY_POSITION = Object.fromEntries(
  Object.entries(POSITION_BY_LANE_ROLE).map(([lane, pos]) => [pos, lane]),
);

/**
 * Pozisyon ya da lane rolu yazimindan lane rolu.
 *
 * Kabul edilen: `"pos3"`, `3` (Overwolf `position`), `"offlane"`. Taninmazsa
 * bos metin.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function laneRoleOf(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (LANE_ROLES.includes(raw)) {
    return raw;
  }
  return LANE_ROLE_BY_POSITION[/^[1-5]$/.test(raw) ? "pos" + raw : raw] || "";
}

/** Duzenlenebilir liste alanlari ve liste basina tavan. */
export const HERO_LIST_FIELDS = [
  "counterHeroes",
  "counterItems",
  "requiredItems",
  "situationalItems",
  "removedItems",
];

/** Bir listede tutulabilecek en fazla kayit (kotuye kullanimi sinirlar). */
export const MAX_LIST_LENGTH = 12;

/** Gecerli hero anahtarlari. */
const KNOWN_HEROES = new Set(Object.keys(heroOverrides));

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isKnownHero(value) {
  return KNOWN_HEROES.has(normalizeHeroKey(value));
}

/** Tum hero anahtarlari (alfabetik). */
export function heroKeys() {
  return [...KNOWN_HEROES].sort();
}

/**
 * Bir kaydin oynanabildigi pozisyonlar ("pos1".."pos5").
 * @param {Record<string, any>|null} record `heroRecord` ciktisi
 * @returns {Set<string>}
 */
export function heroPositions(record) {
  return new Set(
    (record?.laneRoles || [])
      .map((role) => POSITION_BY_LANE_ROLE[role])
      .filter(Boolean),
  );
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function clampScore(value) {
  const number = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(100, number));
}

/**
 * Serbest metinden gecerli item listesi.
 *
 * Kaldirilmis itemler burada elenir: kayit dosyasina girmelerine izin verilirse
 * oneri motoru onlari tekrar tekrar elemek zorunda kalir ve ekranda "kaydettim
 * ama gorunmuyor" durumu olusur.
 *
 * @param {unknown} list
 * @returns {string[]}
 */
function itemList(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const key = normalizeItemKey(raw);
    if (
      !key ||
      isRetiredItem(key) ||
      out.includes(key) ||
      !/^[a-z0-9_]{2,40}$/.test(key) ||
      !/[a-z]/.test(key)
    ) {
      continue;
    }
    out.push(key);
    if (out.length >= MAX_LIST_LENGTH) {
      break;
    }
  }
  return out;
}

/**
 * @param {unknown} list
 * @returns {string[]}
 */
function heroList(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const key = normalizeHeroKey(raw);
    if (!key || !KNOWN_HEROES.has(key) || out.includes(key)) {
      continue;
    }
    out.push(key);
    if (out.length >= MAX_LIST_LENGTH) {
      break;
    }
  }
  return out;
}

/**
 * @param {unknown} list
 * @returns {string[]}
 */
function laneRoleList(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const key = String(raw || "")
      .trim()
      .toLowerCase();
    if (LANE_ROLES.includes(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

/**
 * Istemciden gelen bir duzenlemeyi guvenli hale getirir.
 *
 * YALNIZCA GONDERILEN ALANLAR donulur. Eksik alanlar `undefined` birakilir ki
 * birlestirme sirasinda tohum veri korunsun: arayuz tek bir listeyi kaydettiginde
 * digerlerinin silinmesi sessiz bir veri kaybi olurdu.
 *
 * @param {Record<string, any>|null} patch
 * @returns {Record<string, any>}
 */
export function normalizeHeroOverride(patch) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!patch || typeof patch !== "object") {
    return out;
  }

  if (patch.roleValues && typeof patch.roleValues === "object") {
    const values = {};
    for (const key of ROLE_VALUE_KEYS) {
      if (patch.roleValues[key] !== undefined) {
        values[key] = clampScore(patch.roleValues[key]);
      }
    }
    if (Object.keys(values).length) {
      out.roleValues = values;
    }
  }

  if (patch.laneRoles !== undefined) {
    out.laneRoles = laneRoleList(patch.laneRoles);
  }
  // Bos dizi GECERLI bir cevap: "bu hero hicbir ozellik tasimiyor" demek, o
  // hero uzerinden uretilen tehdit onerisini kapatmanin tek yolu.
  if (patch.traits !== undefined) {
    out.traits = normalizeTraitList(patch.traits);
  }
  if (patch.counterHeroes !== undefined) {
    out.counterHeroes = heroList(patch.counterHeroes);
  }
  for (const field of [
    "counterItems",
    "requiredItems",
    "situationalItems",
    "removedItems",
  ]) {
    if (patch[field] !== undefined) {
      out[field] = itemList(patch[field]);
    }
  }

  return out;
}

/**
 * Bir hero'nun tohum kaydi (kullanicinin DEPODAKI duzenlemesi olmadan).
 *
 * Iki katman birlesir: uretilmis veri (hero-overrides.js + hero-traits.js) ve
 * onun uzerine binen ELLE tutulan varsayilanlar (hero-seed-overrides.js).
 * Ikincisi ekranda yapilip kalici kilinmis duzenlemedir: "Sifirla" depodaki
 * kaydi sildiginde hero uretilmis veriye degil BURAYA doner.
 *
 * @param {string} hero
 * @returns {Record<string, any>|null}
 */
export function heroSeed(hero) {
  const key = normalizeHeroKey(hero);
  const seed = heroOverrides[key];
  if (!seed) {
    return null;
  }
  const base = {
    hero: key,
    laneRoles: [...(seed.laneRoles || [])],
    traits: heroTraitSeed(key),
    roleValues: { ...seed.roleValues },
    counterHeroes: [...(seed.counterHeroes || [])],
    counterItems: [...(seed.counterItems || [])],
    requiredItems: [...(seed.requiredItems || [])],
    situationalItems: [...(seed.situationalItems || [])],
    removedItems: [],
  };
  // Elle yazilan varsayilan da bir duzenlemedir: depodan geleniyle AYNI
  // temizlikten gecer ki bozuk bir satir kataloga sizmasin. Yalnizca yazilmis
  // alanlar doner, dolayisiyla eksik birakilan alan uretilmis tohumda kalir.
  const manual = normalizeHeroOverride(heroSeedOverrides[key]);
  const record = { ...base, ...manual, hero: key };
  record.roleValues = { ...base.roleValues, ...(manual.roleValues || {}) };
  return record;
}

/**
 * Tohum + kullanici duzenlemesi.
 *
 * @param {string} hero
 * @param {Record<string, any>|null} [override] Tek hero'nun duzenlemesi
 * @returns {Record<string, any>|null}
 */
export function heroRecord(hero, override = null) {
  const seed = heroSeed(hero);
  if (!seed) {
    return null;
  }
  const patch = normalizeHeroOverride(override);
  const record = { ...seed, ...patch, hero: seed.hero };
  record.roleValues = { ...seed.roleValues, ...(patch.roleValues || {}) };
  // Duzenlenmis kayit isaretlenir: ekran "bu hero elle ayarlandi" diyebilsin.
  record.edited = Object.keys(patch).length > 0;
  return record;
}

/**
 * Tum katalog: hero anahtari -> birlesik kayit.
 *
 * @param {Record<string, Record<string, any>>} [overrides] hero -> duzenleme
 * @returns {Record<string, Record<string, any>>}
 */
export function heroCatalog(overrides = {}) {
  /** @type {Record<string, Record<string, any>>} */
  const out = {};
  for (const hero of KNOWN_HEROES) {
    out[hero] = heroRecord(hero, overrides?.[hero] || null);
  }
  return out;
}

/**
 * Istemciden gelen TUM duzenleme kumesini temizler.
 *
 * Tanimadigi hero'lari ve bos kayitlari atar; kayit dosyasinin uydurma
 * anahtarlarla sismesini engeller.
 *
 * @param {Record<string, any>} plans
 * @returns {Record<string, Record<string, any>>}
 */
export function normalizeHeroPlans(plans) {
  /** @type {Record<string, Record<string, any>>} */
  const out = {};
  for (const [rawHero, patch] of Object.entries(plans || {})) {
    const hero = normalizeHeroKey(rawHero);
    if (!hero || !KNOWN_HEROES.has(hero)) {
      continue;
    }
    const clean = normalizeHeroOverride(patch);
    if (Object.keys(clean).length) {
      out[hero] = clean;
    }
  }
  return out;
}

/**
 * Iki duzenleme AYNI mi? Ikisi de once temizlenir; alan sirasi ve bos alanlar
 * farki yaratmaz, liste sirasi yaratir (plan sirasi tavsiyeyi etkiliyor).
 *
 * @param {Record<string, any>|null|undefined} a
 * @param {Record<string, any>|null|undefined} b
 * @returns {boolean}
 */
export function sameHeroOverride(a, b) {
  return (
    JSON.stringify(normalizeHeroOverride(a || null)) ===
    JSON.stringify(normalizeHeroOverride(b || null))
  );
}

/**
 * VARSAYILANDAN farkli olan hero'lar ("Tavsiyeleri yonet" ekranindaki
 * "N hero duzenlenmis" sayisi ve vurgu).
 *
 * Varsayilan, katalog yoneticisinin "Varsayilan olarak kaydet" dedigi andaki
 * duzenleme kumesidir. O andan sonra yapilan ya da geri alinan her duzenleme
 * burada gorunur; hic kaydedilmediyse tohum veriden farkli olan her hero.
 *
 * @param {Record<string, Record<string, any>>} plans Gecerli duzenlemeler
 * @param {Record<string, Record<string, any>>} [defaults] Varsayilan duzenlemeler
 * @returns {string[]}
 */
export function editedHeroKeys(plans, defaults = {}) {
  const keys = new Set([
    ...Object.keys(plans || {}),
    ...Object.keys(defaults || {}),
  ]);
  // Ham kayitlar degil, ETKIN sonuc karsilastirilir: koddaki varsayilanla ayni
  // sonucu veren bir kayit (ornek: koda tasinmis bir duzenleme) duzenleme
  // sayilmaz.
  return [...keys]
    .filter(
      (hero) =>
        effectiveRecordKey(hero, plans?.[hero]) !==
        effectiveRecordKey(hero, defaults?.[hero]),
    )
    .sort();
}

/**
 * Kaydin ETKIN hali, karsilastirilabilir metin olarak.
 * @param {string} hero
 * @param {Record<string, any>|null|undefined} override
 * @returns {string}
 */
function effectiveRecordKey(hero, override) {
  const record = heroRecord(hero, override || null);
  if (!record) {
    return "";
  }
  const { edited, ...rest } = record;
  return JSON.stringify(rest);
}

/**
 * Bu duzenleme koddaki varsayilani (tohum) DEGISTIRIYOR mu?
 *
 * @param {string} hero
 * @param {Record<string, any>|null|undefined} override
 * @returns {boolean}
 */
export function changesHeroSeed(hero, override) {
  return effectiveRecordKey(hero, override) !== effectiveRecordKey(hero, null);
}

/**
 * Eski "Tavsiyeleri yonet" kaydini (`{ add, remove }`) yeni sekle cevirir.
 *
 * Eski ekran hero basina yalnizca iki liste tutuyordu. Kayitlar depoda duruyor
 * ve sessizce yok sayilmalari kullanicinin daha once yaptigi duzenlemeyi
 * kaybetmek olurdu.
 *
 * @param {Record<string, { add?: string[], remove?: string[] }>} legacy
 * @returns {Record<string, Record<string, any>>}
 */
export function heroPlansFromItemPlans(legacy) {
  /** @type {Record<string, any>} */
  const plans = {};
  for (const [rawHero, plan] of Object.entries(legacy || {})) {
    const add = Array.isArray(plan?.add) ? plan.add : [];
    const remove = Array.isArray(plan?.remove) ? plan.remove : [];
    if (!add.length && !remove.length) {
      continue;
    }
    // Duzenlenmis liste tohum listenin YERINE gecer (dialog tam listeyi
    // kaydeder), bu yuzden eski "her zaman oner" kayitlari tohum planin ONUNE
    // eklenir. Yalnizca `add` yazilsaydi hero'nun cekirdek plani silinirdi.
    const seed = heroSeed(rawHero);
    plans[rawHero] = {
      requiredItems: [...add, ...(seed?.requiredItems || [])],
      removedItems: remove,
    };
  }
  return normalizeHeroPlans(plans);
}
