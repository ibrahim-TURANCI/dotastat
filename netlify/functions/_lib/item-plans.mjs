/**
 * Hero basina ELLE duzenlenmis item tavsiyesi ("Tavsiyeleri yonet").
 *
 * NEDEN GEREKLI: otomatik tavsiye hero profillerinden turer ve genel gecerdir.
 * Grubun kendi oyun tarzi bunun disina cikabilir; bir hero'da hep alinan bir
 * item plana yazilmamis olabilir ya da plandaki bir item bu grupta hic
 * calismiyordur. Bu kayit, motorun onerisini KULLANICININ beyaniyla ezer
 * (bkz. live/item-advice.js -> override).
 *
 * GUVENLIK: Kayit anahtari HER ZAMAN oturum cerezindeki account id'dir; tipki
 * mac pozisyonlarinda oldugu gibi (bkz. _lib/match-roles.mjs). Istek
 * govdesinden gelen bir kimlige guvenilmez.
 *
 * PAYLASIM: Duzenleme kisiseldir ama canli mac paneli TEK bir tablo gosterir.
 * Bu yuzden okuma tarafinda izleyicinin kendi kaydi kullanilir; kimse baskasinin
 * ekranini degistiremez.
 */

import heroProfiles from "@dotastat/core/data/hero-profiles.js";
import { normalizeHeroKey, toAccountId } from "@dotastat/core";
import { itemPlanStore } from "./store.mjs";

/**
 * Kayit yalnizca GERCEK bir hero icin acilir.
 *
 * `normalizeHeroKey` bir dogrulama degil, bicimlendirme yapar: tanimadigi
 * metni de gecirir. Tek basina kullanilirsa istemci istedigi anahtari
 * yazabilir ve kova uydurma kayitlarla dolar.
 */
const KNOWN_HEROES = new Set(Object.keys(heroProfiles || {}));

/** Bir oyuncunun duzenleyebilecegi en fazla hero (kotuye kullanimi sinirlar). */
const MAX_HEROES = 200;
/** Bir hero icin listelenebilecek en fazla item. */
const MAX_ITEMS_PER_LIST = 10;

/**
 * @param {{ steamId?: string, accountId?: string }|null} session
 * @returns {string}
 */
export function sessionAccountId(session) {
  return String(session?.accountId || toAccountId(session?.steamId) || "");
}

/**
 * Item anahtari dogrulamasi.
 *
 * Serbest metin kabul edilmez: kayit dogrudan arayuzde gosteriliyor ve
 * ikon adresine giriyor. Dota item anahtarlari yalnizca kucuk harf, rakam
 * ve alt cizgi icerir.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeItemKey(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^item_/, "");
  // En az bir harf sarti: saf rakam hicbir Dota item anahtari degildir ve
  // `String(42)` gibi kazara gonderilen sayilari eler.
  return /^[a-z0-9_]{2,40}$/.test(key) && /[a-z]/.test(key) ? key : "";
}

/**
 * @param {unknown} list
 * @returns {string[]}
 */
function normalizeItemList(list) {
  const rows = Array.isArray(list) ? list : [];
  const seen = new Set();
  for (const row of rows) {
    const key = normalizeItemKey(row);
    if (key) {
      seen.add(key);
    }
  }
  return [...seen].slice(0, MAX_ITEMS_PER_LIST);
}

/**
 * @param {string} accountId
 * @returns {Promise<Record<string, { add: string[], remove: string[] }>>}
 */
export async function readItemPlans(accountId) {
  const key = String(accountId || "");
  if (!key) {
    return {};
  }
  const row = await itemPlanStore().get("plans:" + key);
  const plans = row && typeof row === "object" ? row.plans : null;
  return plans && typeof plans === "object" ? plans : {};
}

/**
 * Tek bir hero'nun duzenlemesini yazar veya siler.
 *
 * @param {string} accountId
 * @param {string} hero
 * @param {{ add?: unknown, remove?: unknown }} plan
 * @returns {Promise<{ ok: boolean, error?: string, plans: Record<string, any> }>}
 */
export async function writeItemPlan(accountId, hero, plan) {
  const key = String(accountId || "");
  if (!key) {
    return { ok: false, error: "oturum-yok", plans: {} };
  }

  const heroKey = normalizeHeroKey(hero);
  if (!heroKey || !KNOWN_HEROES.has(heroKey)) {
    return { ok: false, error: "gecersiz-hero", plans: {} };
  }

  const add = normalizeItemList(plan?.add);
  const remove = normalizeItemList(plan?.remove);

  const current = await readItemPlans(key);
  const next = { ...current };

  // Iki liste de bossa kayit SILINIR; bos bir nesne tutmanin anlami yok ve
  // "duzenlenmis hero" sayaci yaniltici olurdu.
  if (add.length || remove.length) {
    next[heroKey] = { add, remove };
  } else {
    delete next[heroKey];
  }

  if (Object.keys(next).length > MAX_HEROES) {
    return { ok: false, error: "cok-fazla-kayit", plans: current };
  }

  await itemPlanStore().set("plans:" + key, {
    plans: next,
    updatedAt: new Date().toISOString(),
  });

  return { ok: true, plans: next };
}

export { MAX_HEROES, MAX_ITEMS_PER_LIST, normalizeItemKey };
