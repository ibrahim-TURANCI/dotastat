/**
 * Envanteri GORUNMEYEN hero'lar icin tahmini envanter.
 *
 * SORUN
 * -----
 * Canli veri uc seviyede geliyor (bkz. item-advice.js). Ortadaki seviyede —
 * Overwolf kurulu, on hero de biliniyor — envanteri yalnizca KENDIMIZIN ve
 * masaustu uygulamasini calistiran takim arkadaslarimizin goruluyor. Kalan
 * takim arkadaslari ve rakiplerin tamami icin elimizde yalnizca hero var.
 *
 * Bu, tavsiyeyi iki yerden sakatliyordu:
 *
 *   1. Envanteri bilinmeyen satirin onerisi MACIN BASINDA DONUYORDU. "Elinde
 *      ne var" bilinmedigi icin plan hep bastan okunuyor ve 40. dakikada hala
 *      "Phase Boots al" yaziyordu.
 *   2. Rakip esyasina bakan kurallar (item-counters.js) hic calismiyordu.
 *      Rakip carry'nin BKB alacagi neredeyse kesinken, Nullifier onerisi ancak
 *      envanteri gercekten gorebildigimiz kurulumlarda cikiyordu.
 *
 * COZUM: hero'nun CEKIRDEK PLANINI alacagini varsayip, oyun saatine gore
 * plandan ne kadarini tamamlamis olabilecegini kestiriyoruz.
 *
 * NEDEN MALIYETE GORE SIRALANIYOR
 * -------------------------------
 * Cekirdek plan alim sirasinda DEGIL, pro maclardaki kullanim sikligina gore
 * sirali: Riki'nin listesi Skadi ile, Crystal Maiden'inki Mekansm ile
 * basliyor. Listenin ilk N itemini "alinmis" saymak 8. dakikada Riki'ye Skadi
 * vermek olurdu. Bu yuzden plan once maliyete gore siralanir (bkz.
 * data/item-costs.js): ucuz olan once alinir.
 *
 * NEDEN ALTIN BUTCESI, DUZ BIR ITEM SAYISI DEGIL
 * ----------------------------------------------
 * "Her 7 dakikada bir item" demek destek ile carry'yi ayni kefeye koyar. Oysa
 * 20. dakikada carry'nin ucuncu itemi biterken destek ikincisini zor
 * tamamliyor. Butce lane rolunden turer ve plan butce bitene kadar doldurulur;
 * boylece ayni saatte carry'ye uc, destege iki item yazilir.
 *
 * BU BIR TAHMIN VE OYLE GORUNMELI: doner satirlar `predicted: true` tasir,
 * arayuz bu itemleri SONUK cizer (bkz. LiveInventory.jsx) ve tahmine dayanan
 * her gerekce metninde "bekleniyor" gecer. Tahmini kesin bilgi gibi sunmak,
 * yanlis oldugunda tavsiyenin tamamina olan guveni goturur.
 */

import itemCosts from "../data/item-costs.js";
import { normalizeItemKey } from "./item-keys.js";

/**
 * Lane rolune gore GEC OYUNDA item'e giden altin / dakika.
 *
 * Net worth degil item butcesi: kazanilan altinin bir kismi consumable, ward,
 * dust ve buyback'e gidiyor ve destekte bu pay cok daha buyuk. Sayilar orta
 * seviye bir pub macinin kabaca ortalamasi; amac dakikasi dakikasina dogruluk
 * degil, "bu saatte kac item bitmis olabilir" sorusuna makul bir cevap.
 */
const GOLD_PER_MINUTE = {
  carry: 700,
  mid: 720,
  offlane: 560,
  sup4: 420,
  sup5: 380,
};

/** Lane rolu bilinmiyorsa kullanilan orta deger. */
const DEFAULT_GOLD_PER_MINUTE = 560;

/**
 * Altin kazanci RAMPA ile artar, duz degil.
 *
 * Duz bir "dakikada X altin" carry'yi macin basinda zengin gosteriyordu: 10.
 * dakikada 4900 altinlik butce cikiyor ve Riki'nin eline Nullifier
 * yaziliyordu. Gercekte kazanc lane fazinda dusuk, orta oyunda hizlaniyor.
 *
 * Bu yuzden butce "hiz * dakika * dakika / (dakika + RAMP_MINUTES)" ile
 * olculur: erken oyunda tam hizin altinda kalir, gec oyunda tam hiza yaklasir.
 * RAMP_MINUTES kazancin yarim hiza ulastigi dakikadir.
 */
const RAMP_MINUTES = 12;

/** Tahminin dolduracagi en fazla yuva (ana envanter 6 slot). */
const MAX_PREDICTED = 6;

/**
 * Bir hero'nun dakika basina item butcesi.
 *
 * Birden fazla lane rolu olan hero'da EN YUKSEGI alinir: Pudge hem offlane
 * hem sup5 oynaniyor ve dusuk olani secmek, offlane Pudge'u surekli geride
 * gosterirdi. Fazla tahmin etmek eksik tahmin etmekten iyi degil ama bu
 * durumda hero'nun oynandigi en yaygin rol genelde once yazilmis oluyor.
 *
 * @param {string[]} laneRoles
 * @returns {number}
 */
export function goldPerMinute(laneRoles) {
  const rates = (Array.isArray(laneRoles) ? laneRoles : [])
    .map((role) => GOLD_PER_MINUTE[role])
    .filter((rate) => Number.isFinite(rate));
  return rates.length ? Math.max(...rates) : DEFAULT_GOLD_PER_MINUTE;
}

/**
 * Bir hero'nun verilen dakikada item'e harcamis olabilecegi altin.
 *
 * @param {string[]} laneRoles
 * @param {number} gameTime Saniye cinsinden oyun saati
 * @returns {number}
 */
export function itemBudget(laneRoles, gameTime) {
  const minutes = Math.max(0, Number(gameTime) || 0) / 60;
  if (!minutes) {
    return 0;
  }
  const ramp = minutes / (minutes + RAMP_MINUTES);
  return goldPerMinute(laneRoles) * minutes * ramp;
}

/**
 * Bir hero'nun TAHMINI envanteri.
 *
 * Plan maliyete gore siralanir ve butce bitene kadar doldurulur. Zaten
 * gorunen itemler (kismi veri: bazi satirlarda esyanin bir kismi biliniyor)
 * butceden DUSULUR ve tekrar yazilmaz — ayni item iki kez gorunurse envanter
 * yalan soyler.
 *
 * @param {Object} input
 * @param {Record<string, any>|null} input.record Hero katalog kaydi
 * @param {number} input.gameTime Saniye cinsinden oyun saati
 * @param {Iterable<string>} [input.owned] Gercekten gorulen itemler
 * @returns {string[]} Tahmini item anahtarlari (alim sirasina yakin)
 */
export function predictInventory({ record, gameTime, owned = [] }) {
  if (!record) {
    return [];
  }

  const have = new Set([...owned].map(normalizeItemKey).filter(Boolean));
  const plan = (record.requiredItems || [])
    .map(normalizeItemKey)
    .filter(Boolean);

  // Gorunen itemlerin plandaki karsiligi butceyi zaten tuketmis sayilir;
  // yoksa elinde Manta gorunen bir hero'ya ayrica Manta tahmin ederdik.
  let budget = itemBudget(record.laneRoles, gameTime);
  for (const key of plan) {
    if (have.has(key)) {
      budget -= Number(itemCosts[key] || 0);
    }
  }

  const candidates = plan
    .filter((key) => !have.has(key))
    .map((key) => ({ key, cost: Number(itemCosts[key] || 0) }))
    // Fiyati bilinmeyen item en sona: bedava sayip basa almak, tahmini
    // envanteri tanimadigimiz itemlerle doldururdu.
    .sort((a, b) => (a.cost || Infinity) - (b.cost || Infinity));

  /** @type {string[]} */
  const predicted = [];
  for (const candidate of candidates) {
    if (predicted.length >= MAX_PREDICTED || !candidate.cost) {
      break;
    }
    if (candidate.cost > budget) {
      // Plan maliyete gore sirali: bu item butceye sigmiyorsa sonrakiler hic
      // sigmaz.
      break;
    }
    budget -= candidate.cost;
    predicted.push(candidate.key);
  }

  return predicted;
}

export { GOLD_PER_MINUTE, MAX_PREDICTED, RAMP_MINUTES };
