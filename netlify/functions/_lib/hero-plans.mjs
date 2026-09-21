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
 * GUVENLIK: yazma yetkisi oturum cerezindeki account id'nin KADRODA olmasina
 * baglidir (bkz. hero-plans.mjs); istek govdesinden gelen bir kimlige
 * guvenilmez.
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
 * Ortak katalogdaki tum hero duzenlemeleri.
 *
 * @returns {Promise<Record<string, Record<string, any>>>}
 */
export async function readHeroPlans() {
  const store = heroPlanStore();
  const row = await store.get(SHARED_KEY);
  const stored = row && typeof row === "object" ? row.heroes : null;
  if (stored && typeof stored === "object") {
    return normalizeHeroPlans(stored);
  }

  // Ortak kayit henuz yok: eski kisisel kayitlar tasinir ve BIR KEZ yazilir.
  const migrated = await migrateLegacyPlans();
  await store.set(SHARED_KEY, {
    heroes: migrated,
    updatedAt: new Date().toISOString(),
    migrated: true,
  });
  return migrated;
}

/**
 * Tek bir hero'nun duzenlemesini yazar veya siler.
 *
 * Bos bir govde ("hicbir alan yollanmadi") kaydi SILER: arayuzdeki "Sıfırla"
 * dugmesi budur ve hero tohum veriye geri doner.
 *
 * @param {string} accountId Yazan kisi (yalnizca iz olarak saklanir)
 * @param {string} hero
 * @param {Record<string, any>} patch
 * @returns {Promise<{ ok: boolean, error?: string, heroes: Record<string, any> }>}
 */
export async function writeHeroPlan(accountId, hero, patch) {
  const heroKey = normalizeHeroKey(hero);
  if (!heroKey || !isKnownHero(heroKey)) {
    return { ok: false, error: "gecersiz-hero", heroes: {} };
  }

  const clean = normalizeHeroOverride(patch);
  const current = await readHeroPlans();
  const next = { ...current };

  if (Object.keys(clean).length) {
    next[heroKey] = clean;
  } else {
    delete next[heroKey];
  }

  if (Object.keys(next).length > MAX_HEROES) {
    return { ok: false, error: "cok-fazla-kayit", heroes: current };
  }

  await heroPlanStore().set(SHARED_KEY, {
    heroes: next,
    updatedAt: new Date().toISOString(),
    updatedBy: String(accountId || ""),
  });

  return { ok: true, heroes: next };
}

export { MAX_HEROES, SHARED_KEY };
