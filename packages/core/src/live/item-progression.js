/**
 * Kademeli item tavsiyesi: KUCUKTEN BUYUGE ve OYUN SAATINE gore.
 *
 * SORUN
 * -----
 * Hero plani bitmis itemleri tasiyor (Manta, Satanic, Bloodthorn). Macin
 * 8. dakikasinda "Manta al" demek oyuncuya 4650 altinlik bir hedef verir ama
 * dukkanda simdi ne alacagini soylemez. Oyuncunun gercekte sordugu soru
 * "SIRADAKI adim ne": Manta icin once Yasha, Yasha bitince Manta.
 *
 * Tersi de bir sorun: 30. dakikada Raindrop ya da Satanic yerine Reaver
 * onermek oyunun o anina uymuyor. Gec oyunda kucuk item ve ara parca
 * GOSTERILMEZ; hedef item dogrudan onerilir.
 *
 * KURALLAR
 *   1. Ara parca yalnizca kendisi de recipe ile yapilan ve anlamli fiyatta
 *      (STEP_MIN_COST) bir item olabilir: Yasha, Sange, Orchid, Basher,
 *      Mekansm... Diadem, Reaver gibi temel parcalar adim sayilmaz — onlar
 *      dukkanin isi, tavsiyenin degil.
 *   2. Birden fazla ara parca eksikse UCUZU once gelir (kucukten buyuge).
 *   3. Sahip olunan itemin parcalari da "elde var" sayilir: Manta'si olana
 *      Yasha, Bloodthorn'u olana Orchid onerilmez.
 *   4. Oyun saati LATE_GAME_SECONDS'i gectiyse ara parca ve kucuk item
 *      onerilmez; hedef dogrudan gosterilir.
 *   5. Oyun saati BILINMIYORSA hicbir zaman kurali uygulanmaz; eski davranis
 *      (plandaki item oldugu gibi) korunur. Eksik veriyle tahmin yurutmek
 *      yerine bildigimiz davranista kaliriz.
 *
 * Bu modul SAFTIR: ag istegi yapmaz, saat okumaz.
 */

import itemComponents from "../data/item-components.js";
import itemCosts from "../data/item-costs.js";
import { normalizeItemKey } from "./item-keys.js";

/**
 * Bu dakikadan sonra kucuk item ve ara parca onerilmez.
 *
 * 20-25. dakika arasi, orta seviye bir pub macinda cekirdeklerin ikinci
 * buyuk itemini bitirdigi pencere; bu noktadan sonra Wand/Raindrop gibi
 * erken itemler envanter yuvasini hak etmiyor.
 */
const LATE_GAME_SECONDS = 20 * 60;

/** Bu fiyatin altindaki item "kucuk" sayilir ve gec oyunda onerilmez. */
const SMALL_ITEM_COST = 1000;

/** Ara parca sayilmasi icin gereken en dusuk fiyat. */
const STEP_MIN_COST = 1700;

/** @param {string} key */
function costOf(key) {
  return Number(itemCosts[key] || 0);
}

/**
 * Item listesini ALIM SIRASINA yaklastirir: ucuz olan once.
 *
 * Hero planlari alim sirasinda degil pro maclardaki kullanim sikligina gore
 * dizili (Riki'nin listesi Skadi ile basliyor). Hem tahmini envanter hem
 * "simdi ne alsin" onerisi plani AYNI sekilde okumali; biri maliyete digeri
 * liste sirasina bakarsa tahmin Riki'ye Diffusal yazarken oneri Skadi der.
 * Fiyati bilinmeyen item en sona gider; sira esitlikte korunur.
 *
 * @param {Iterable<string>} keys
 * @returns {string[]}
 */
export function sortByCost(keys) {
  return [...(keys || [])]
    .map((key, index) => ({ key, index, cost: costOf(normalizeItemKey(key)) }))
    .sort(
      (a, b) =>
        (a.cost || Infinity) - (b.cost || Infinity) || a.index - b.index,
    )
    .map((row) => row.key);
}

/**
 * Bir itemin (recipe haric) dogrudan parcalari.
 * @param {string} key
 * @returns {string[]}
 */
export function itemComponentsOf(key) {
  const list = itemComponents[normalizeItemKey(key)];
  return Array.isArray(list)
    ? list
        .map(normalizeItemKey)
        .filter((part) => part && !part.startsWith("recipe_"))
    : [];
}

/**
 * Sahip olunan itemler + onlarin (ozyinelemeli) tum parcalari.
 *
 * @param {Iterable<string>} owned
 * @returns {Set<string>}
 */
export function ownedWithComponents(owned) {
  const out = new Set();
  const stack = [...(owned || [])].map(normalizeItemKey).filter(Boolean);
  while (stack.length) {
    const key = stack.pop();
    if (out.has(key)) {
      continue;
    }
    out.add(key);
    stack.push(...itemComponentsOf(key));
  }
  return out;
}

/**
 * Bot ailesi: Boots of Speed ve onu (ozyinelemeli) iceren her item.
 *
 * Liste yazilmaz, bilesen verisinden turer: Phase, Treads, Arcane, Tranquil,
 * Travel ve ust surumleri (Guardian Greaves, Boots of Bearing, Travel 2)
 * yamayla degisse de dogru kalir.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isBootItem(key) {
  const normalized = normalizeItemKey(key);
  return Boolean(normalized) && ownedWithComponents([normalized]).has("boots");
}

/**
 * Bir itemin, verilen botun UST SURUMU olup olmadigi (bot onun bileseni mi).
 * Tranquil -> Boots of Bearing, Arcane -> Guardian Greaves, Boots of Speed ->
 * her bot.
 *
 * @param {string} key
 * @param {string} boot
 * @returns {boolean}
 */
export function isBootUpgradeOf(key, boot) {
  const target = normalizeItemKey(key);
  const base = normalizeItemKey(boot);
  return (
    Boolean(target) &&
    target !== base &&
    ownedWithComponents([target]).has(base)
  );
}

/**
 * Elde tutulan EN UST botlar: baska bir eldeki botun bileseni olanlar atilir.
 *
 * @param {Iterable<string>} held Bilesenleri ACILMAMIS envanter
 * @returns {string[]}
 */
export function heldBoots(held) {
  const boots = [...new Set([...(held || [])].map(normalizeItemKey))].filter(
    isBootItem,
  );
  return boots.filter(
    (boot) => !boots.some((other) => isBootUpgradeOf(other, boot)),
  );
}

/**
 * Oyun saati biliniyor mu? `null`/`undefined`/sayi olmayan deger "bilinmiyor".
 * @param {unknown} gameTime
 */
export function hasGameTime(gameTime) {
  return (
    gameTime !== null &&
    gameTime !== undefined &&
    gameTime !== "" &&
    Number.isFinite(Number(gameTime))
  );
}

/**
 * Oyun gec evrede mi? Saat bilinmiyorsa `false` (eski davranis).
 * @param {unknown} gameTime
 */
export function isLateGame(gameTime) {
  return hasGameTime(gameTime) && Number(gameTime) >= LATE_GAME_SECONDS;
}

/**
 * Kucuk item mi? Fiyati bilinmeyen item kucuk SAYILMAZ: tanimadigimiz bir
 * itemi gizlemek, gostermekten daha buyuk bir hata.
 * @param {string} key
 */
export function isSmallItem(key) {
  const cost = costOf(normalizeItemKey(key));
  return cost > 0 && cost < SMALL_ITEM_COST;
}

/**
 * Hedef item icin SIRADAKI adim.
 *
 * @param {string} target Onerilmek istenen (bitmis) item
 * @param {Object} context
 * @param {Set<string>} context.have `ownedWithComponents` ciktisi
 * @param {unknown} context.gameTime Saniye; bilinmiyorsa adim uretilmez
 * @param {(key: string) => boolean} [context.blocked] Onerilemeyen parca
 *   (kaldirilmis, oyundan cikmis, takimda baskasinda...)
 * @returns {{ key: string, buildsInto: string|null }}
 */
export function nextBuildStep(target, context) {
  const key = normalizeItemKey(target);
  const { have, gameTime, blocked } = context || {};
  if (!key || !hasGameTime(gameTime) || isLateGame(gameTime)) {
    return { key, buildsInto: null };
  }

  const step = itemComponentsOf(key)
    .filter(
      (part) =>
        costOf(part) >= STEP_MIN_COST &&
        itemComponentsOf(part).length > 0 &&
        !have?.has(part) &&
        !blocked?.(part),
    )
    .sort((a, b) => costOf(a) - costOf(b))[0];

  return step ? { key: step, buildsInto: key } : { key, buildsInto: null };
}

export { LATE_GAME_SECONDS, SMALL_ITEM_COST, STEP_MIN_COST };
