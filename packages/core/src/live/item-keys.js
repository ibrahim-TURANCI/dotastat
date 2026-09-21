/**
 * Item anahtari normalizasyonu, gorunen ad ve ikon adresi.
 *
 * NEDEN AYRI BIR MODUL: item anahtari uc ayri yerden geliyor ve ucu de farkli
 * yaziyor —
 *
 *   GSI            : `item_black_king_bar` (oyunun dahili adi, her zaman dogru)
 *   hero planlari  : `battle_fury`, `linkensphere` (elle yazilmis, KONUSMA DILI)
 *   arayuz girisi  : kullanicinin dialoga yazdigi serbest metin
 *
 * Ortadaki grup Dota'nin gercek anahtarlariyla ortusmuyordu ve ikon adresi
 * dogrudan anahtardan uretildigi icin o itemlerin ikonu HIC gorunmuyordu:
 * Khanda, Battle Fury, Boots of Travel, Eul's, Linken's, Drum, Gleipnir,
 * Parasma, Daedalus, Scythe of Vyse, Ghost Scepter, Aghanim's Scepter.
 * Kutu ciziliyor, icindeki resim 404 donuyordu.
 *
 * Bu yuzden normalizasyon TEK bir yerde yapilir ve takma adlar gercek Dota
 * anahtarina cevrilir. Ikon, gorunen ad ve "bu item elimde mi" karsilastirmasi
 * ayni anahtari kullanir; biri duzeldiginde hepsi duzelir.
 */

import retiredItems from "../data/retired-items.js";

/**
 * Konusma dilindeki / eski yazimlarin GERCEK Dota anahtari karsiligi.
 *
 * Soldaki anahtar bu depoda gecen yazim, sagdaki oyunun (ve CDN'in) kullandigi
 * ad. Dota'nin ic adlari cogu zaman itemin bugunku adiyla ilgisiz: Khanda
 * dosyada `angels_demise`, Gleipnir `gungir`, Parasma `devastator` olarak
 * duruyor — tahmin edilebilir bir kural yok, tablo sart.
 */
const ITEM_KEY_ALIASES = {
  aghanims_scepter: "ultimate_scepter",
  aghanim_scepter: "ultimate_scepter",
  aghanims_blessing: "ultimate_scepter_2",
  aghanim_shard: "aghanims_shard",
  battle_fury: "bfury",
  boots_of_travel: "travel_boots",
  daedalus: "greater_crit",
  drum_of_endurance: "ancient_janggo",
  euls: "cyclone",
  euls_scepter: "cyclone",
  euls_scepter_of_divinity: "cyclone",
  ghost_scepter: "ghost",
  gleipnir: "gungir",
  khanda: "angels_demise",
  linkens_sphere: "sphere",
  linkensphere: "sphere",
  linken_sphere: "sphere",
  parasma: "devastator",
  scythe_of_vyse: "sheepstick",
  // Sik gecen kisaltmalar.
  bkb: "black_king_bar",
  pipe_of_insight: "pipe",
  manta_style: "manta",
  vladmirs_offering: "vladmir",
  shivas: "shivas_guard",
  hex: "sheepstick",
};

/**
 * Oyundan KALDIRILMIS itemler.
 *
 * Bunlar hala OpenDota tablosunda ve Valve'in item listesinde duruyor (gecmis
 * maclar okunabilsin diye), bu yuzden "listede var" olmalari var olduklari
 * anlamina gelmiyor. Tavsiye motoru bunlari onerirse kullanici oyunda
 * bulamayacagi bir item icin plan yapar — tavsiyenin tamamina olan guveni
 * gider. Bu yuzden oneri uretiminde bastan elenirler.
 *
 * Envanterde GORUNMELERI engellenmez: eski bir mac kaydi okunuyorsa o item
 * gercekten oradaydi.
 *
 * Liste URETILIR (bkz. scripts/build-retired-items.mjs): kaynak Valve'in yama
 * notlari. Elle tutuldugunda her yamada eskiyor ve eskidigi fark edilmiyordu —
 * Eternal Shroud 7.41'de kalkti, liste bilmiyordu ve item takim onerisinde
 * gorunmeye devam etti.
 */
const RETIRED_ITEMS = new Set(Object.keys(retiredItems));

/**
 * Herhangi bir yazimi tek bir item anahtarina indirger.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeItemKey(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^item_/, "")
    .replace(/[\s-]+/g, "_");
  return ITEM_KEY_ALIASES[base] || base;
}

/**
 * Bu item oyundan kaldirilmis mi?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRetiredItem(value) {
  return RETIRED_ITEMS.has(normalizeItemKey(value));
}

export { ITEM_KEY_ALIASES, RETIRED_ITEMS };
