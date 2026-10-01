/**
 * Hero basina ELLE duzenlenmis tavsiye kaydi ("Tavsiyeleri yonet").
 *
 * NEDEN GEREKLI: otomatik tavsiye uretilmis tohum veriden turer ve genel
 * gecerdir. Grubun kendi oyun tarzi bunun disina cikabilir; bir hero'da hep
 * alinan bir item plana yazilmamis olabilir ya da plandaki bir item bu grupta
 * hic calismiyordur. Bu kayit motorun onerisini KULLANICININ beyaniyla ezer
 * (bkz. heroes/hero-catalog.js -> heroRecord).
 *
 * KAYIT ORTAKTIR
 * --------------
 * Katalog arkadas grubunun ORTAK oyun bilgisidir: "bu hero'da bu item
 * aliniyor" herkes icin ayni seydir. Bu yuzden TEK bir kayitta tutulur
 * (`heroes:shared`) ve kadrodaki herkes ayni kaydi okuyup yazar. Ayrica
 * masaustu uygulamasi da bu kaydi site uzerinden okur (bkz.
 * desktop/src/server/app.js), boylece iki ortamda tek bir katalog vardir.
 *
 * Eskiden kayit KISIYE OZELDI (`heroes:<accountId>`). Iki sorunu vardi: ayni
 * hero'yu iki kisi ayri ayri duzenliyordu ve masaustunde yapilan duzenleme
 * sitede hic gorunmuyordu. Eski kayitlar SILINMEDI; ortak kayit ilk kez
 * okundugunda hepsi (ve daha eski `{ add, remove }` bicimindeki item-plan
 * kayitlari) birlestirilip ortak kayda tasinir.
 *
 * VARSAYILAN
 * ----------
 * Kayit iki kume tasir: `heroes` (gecerli duzenlemeler; tavsiye motoru
 * bunu kullanir) ve `defaults` (katalog yoneticisinin "Varsayilan olarak
 * kaydet" dedigi andaki `heroes`). Ekrandaki "N hero duzenlenmis" ve vurgu
 * ikisinin FARKIDIR (bkz. core editedHeroKeys); "Sifirla" hero'yu
 * varsayilanina dondurur. Varsayilani kaydetmek tavsiyeyi degistirmez, yalnizca
 * "neyin yeni duzenleme oldugu" sorusunun referansini tasir.
 *
 * GUVENLIK: yazma yetkisi oturum cerezindeki account id'nin KADRODA olmasina,
 * varsayilani kaydetmek ise `catalogAdmin` olmasina baglidir (bkz.
 * hero-plans.mjs); istek govdesinden gelen bir kimlige guvenilmez.
 */

import {
  heroPlansFromItemPlans,
  isKnownHero,
  normalizeHeroKey,
  normalizeHeroOverride,
  normalizeHeroPlans,
  toAccountId,
} from "@dotastat/core";
import { heroPlanStore, itemPlanStore } from "./store.mjs";
import { readItemPlans } from "./item-plans.mjs";

/** Ortak katalogun anahtari. */
const SHARED_KEY = "heroes:shared";

/** Katalogda tutulabilecek en fazla hero (kotuye kullanimi sinirlar). */
const MAX_HEROES = 200;

/**
 * @param {{ steamId?: string, accountId?: string }|null} session
 * @returns {string}
 */
export function sessionAccountId(session) {
  return String(session?.accountId || toAccountId(session?.steamId) || "");
}

/**
 * Kisiye ozel ESKI kayitlari ortak kataloga tasir.
 *
 * Bir kez calisir: ortak kayit yazildiktan sonra bu yola bir daha girilmez.
 * Birlesme sirasi onemsizdir — ayni hero'yu iki kisi duzenlediyse biri kazanir
 * ve kullanici zaten uzerine yazabilir; onemli olan hicbir duzenlemenin
 * sessizce kaybolmamasi.
 *
 * @returns {Promise<Record<string, Record<string, any>>>}
 */
async function migrateLegacyPlans() {
  /** @type {Record<string, Record<string, any>>} */
  const merged = {};

  // Once en eski bicim (`plans:<accountId>` -> { add, remove }), sonra kisiye
  // ozel hero kayitlari: yeni bicim eskisinin uzerine yazsin.
  try {
    const store = itemPlanStore();
    for (const key of await store.keys()) {
      if (!key.startsWith("plans:")) {
        continue;
      }
      const accountId = key.slice("plans:".length);
      Object.assign(
        merged,
        heroPlansFromItemPlans(await readItemPlans(accountId)),
      );
    }
  } catch {
    // Eski kova okunamadi; goc eksik kalir ama katalog calismaya devam eder.
  }

  try {
    const store = heroPlanStore();
    for (const key of await store.keys()) {
      if (!key.startsWith("heroes:") || key === SHARED_KEY) {
        continue;
      }
      const row = await store.get(key);
      const stored = row && typeof row === "object" ? row.heroes : null;
      if (stored && typeof stored === "object") {
        Object.assign(merged, normalizeHeroPlans(stored));
      }
    }
  } catch {
    // Ayni gerekce.
  }

  return merged;
}

/**
 * Ortak kaydin tamami: gecerli duzenlemeler ve varsayilan.
 *
 * @returns {Promise<{ heroes: Record<string, Record<string, any>>, defaults: Record<string, Record<string, any>>, row: Record<string, any> }>}
 */
export async function readHeroCatalog() {
  const store = heroPlanStore();
  const row = await store.get(SHARED_KEY);
  const stored = row && typeof row === "object" ? row.heroes : null;
  if (stored && typeof stored === "object") {
    return {
      heroes: normalizeHeroPlans(stored),
      defaults: normalizeHeroPlans(row.defaults || {}),
      row,
    };
  }

  // Ortak kayit henuz yok: eski kisisel kayitlar tasinir ve BIR KEZ yazilir.
  const migrated = await migrateLegacyPlans();
  const fresh = {
    heroes: migrated,
    defaults: {},
    updatedAt: new Date().toISOString(),
    migrated: true,
  };
  await store.set(SHARED_KEY, fresh);
  return { heroes: migrated, defaults: {}, row: fresh };
}

/**
 * Ortak katalogdaki GECERLI hero duzenlemeleri (tavsiye motorunun girdisi).
 *
 * @returns {Promise<Record<string, Record<string, any>>>}
 */
export async function readHeroPlans() {
  return (await readHeroCatalog()).heroes;
}

/**
 * Tek bir hero'nun duzenlemesini yazar ya da varsayilanina dondurur.
 *
 * Bos bir govde ("hicbir alan yollanmadi") arayuzdeki "Sıfırla" dugmesidir:
 * hero VARSAYILAN kaydina doner; varsayilanda yoksa tohum veriye.
 *
 * @param {string} accountId Yazan kisi (yalnizca iz olarak saklanir)
 * @param {string} hero
 * @param {Record<string, any>} patch
 * @returns {Promise<{ ok: boolean, error?: string, heroes: Record<string, any>, defaults: Record<string, any> }>}
 */
export async function writeHeroPlan(accountId, hero, patch) {
  const heroKey = normalizeHeroKey(hero);
  if (!heroKey || !isKnownHero(heroKey)) {
    return { ok: false, error: "gecersiz-hero", heroes: {}, defaults: {} };
  }

  const clean = normalizeHeroOverride(patch);
  const { heroes: current, defaults, row } = await readHeroCatalog();
  const next = { ...current };

  if (Object.keys(clean).length) {
    next[heroKey] = clean;
  } else if (defaults[heroKey]) {
    next[heroKey] = defaults[heroKey];
  } else {
    delete next[heroKey];
  }

  if (Object.keys(next).length > MAX_HEROES) {
    return { ok: false, error: "cok-fazla-kayit", heroes: current, defaults };
  }

  await heroPlanStore().set(SHARED_KEY, {
    ...row,
    heroes: next,
    defaults,
    updatedAt: new Date().toISOString(),
    updatedBy: String(accountId || ""),
  });

  return { ok: true, heroes: next, defaults };
}

/**
 * Gecerli duzenlemeleri VARSAYILAN olarak kaydeder.
 *
 * Tavsiye degismez (motor zaten `heroes` kumesini kullaniyor); degisen,
 * ekrandaki "duzenlenmis" isaretinin referansidir. Yetki kontrolu cagiranda
 * (bkz. hero-plans.mjs).
 *
 * @param {string} accountId Kaydeden kisi (iz olarak saklanir)
 * @returns {Promise<{ heroes: Record<string, any>, defaults: Record<string, any> }>}
 */
export async function saveHeroDefaults(accountId) {
  const { heroes, row } = await readHeroCatalog();
  await heroPlanStore().set(SHARED_KEY, {
    ...row,
    heroes,
    defaults: heroes,
    defaultsSavedAt: new Date().toISOString(),
    defaultsSavedBy: String(accountId || ""),
  });
  return { heroes, defaults: heroes };
}

export { MAX_HEROES, SHARED_KEY };
