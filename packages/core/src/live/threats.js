/**
 * Rakip kompozisyonundaki TEHDITLER ve onlara cevap veren itemler.
 *
 * NE ISE YARAR: "rakipte gorunmez hero var" ile "Essence Distiller al" arasindaki
 * baglanti. Tavsiye motoru hem tek oyuncu satirinda hem takim onerilerinde bu
 * tabloyu kullanir, boylece iki yerde ayni gerekce gorunur.
 *
 * NEDEN ELLE YAZILMIS BIR LISTE
 * -----------------------------
 * Once Valve'in yetenek verisinden turetmeyi denedim: `behavior` bitmaskesi,
 * hasar turu ve aciklama metni. Sonuc kullanilamazdi — "pasif yetenegi var"
 * 127 hero'nun 119'unu, "hedefli buyusu var" 91'ini isaretliyordu. Oysa buradaki
 * soru "teknik olarak pasifi var mi" degil, "bu hero YUZUNDEN Silver Edge
 * alinir mi". O yargi veride yok.
 *
 * Bu yuzden listeler elle tutulur. Bir hero eklerken olcut su: O HERO'YU
 * GORDUGUNDE bu itemi almayi dusunur musun? Cevap "belki" ise eklemeyin;
 * yaniltici bir oneri, hic oneri olmamasindan kotudur.
 */

import { normalizeHeroKey } from "../heroes/hero-names.js";
import { normalizeItemKey } from "./item-keys.js";

/**
 * Tehdit tanimlari.
 *
 * `heroes`  : bu tehdidi TASIYAN rakip hero'lar
 * `items`   : tehdide cevap veren itemler (tercih sirasiyla)
 * `label`   : ekranda gorunen kisa ad
 * `reason`  : oneri kutusunda gorunen gerekce kalibi
 */
const THREATS = [
  {
    key: "invisible",
    label: "görünmez",
    reason: "Rakipte görünmez hero var",
    // Olcut: gorunmezlik ya da faz gecisi ile kacip yeniden giren hero'lar.
    // Aciklamasinda "invisible" gecen her hero degil — Tidehunter'in Ravage'i
    // gorunmezlikten bahsediyor ama kimse Tide icin dedektor almiyor.
    heroes: [
      "riki",
      "bounty_hunter",
      "clinkz",
      "weaver",
      "mirana",
      "nyx_assassin",
      "slark",
      "templar_assassin",
      "treant",
      "sand_king",
      "invoker",
    ],
    items: ["essence_distiller", "dust", "gem"],
  },
  {
    key: "regen",
    label: "can yenileme",
    reason: "Rakipte can yenileyen hero var",
    // Olcut: can yenilemesi/emmesi savasin sonucunu degistiren hero'lar.
    heroes: [
      "necrolyte",
      "huskar",
      "alchemist",
      "wisp",
      "life_stealer",
      "abaddon",
      "undying",
      "dazzle",
      "omniknight",
      "oracle",
      "chen",
      "treant",
      "shredder",
      "broodmother",
      "dragon_knight",
      "night_stalker",
      "winter_wyvern",
      "warlock",
    ],
    items: ["spirit_vessel"],
  },
  {
    key: "escape",
    label: "kaçış",
    reason: "Rakipte kaçan hero var",
    // Olcut: blink/faz ile savastan cikan, susturulmazsa yakalanmayan hero'lar.
    heroes: [
      "puck",
      "storm_spirit",
      "ember_spirit",
      "antimage",
      "faceless_void",
      "void_spirit",
      "queenofpain",
      "morphling",
      "weaver",
      "slark",
      "mirana",
      "batrider",
      "pangolier",
      "nyx_assassin",
    ],
    items: ["orchid", "bloodthorn", "sheepstick"],
  },
  {
    key: "magical",
    label: "büyüsel hasar",
    reason: "Rakip büyü hasarı basıyor",
    // Olcut: hasarinin buyuk kismi buyuden gelen hero'lar.
    heroes: [
      "zuus",
      "leshrac",
      "skywrath_mage",
      "snapfire",
      "venomancer",
      "lina",
      "lion",
      "crystal_maiden",
      "jakiro",
      "warlock",
      "tinker",
      "pugna",
      "death_prophet",
      "disruptor",
      "grimstroke",
      "witch_doctor",
      "ancient_apparition",
      "necrolyte",
      "invoker",
      "queenofpain",
      "shadow_shaman",
      "enigma",
    ],
    items: ["pipe", "black_king_bar", "mekansm", "guardian_greaves"],
  },
  {
    key: "targeted",
    label: "hedefli büyü",
    reason: "Rakipte tek hedefli ulti/skill var",
    // Olcut: Linken'in GERCEKTEN bloklayacagi, tek hedefe basilan buyusu olan
    // hero'lar. Teknik olarak hedefli buyusu olan herkes degil.
    heroes: [
      "legion_commander",
      "pudge",
      "antimage",
      "lina",
      "spirit_breaker",
      "doom_bringer",
      "bane",
      "beastmaster",
      "chaos_knight",
      "axe",
      "lion",
      "shadow_shaman",
      "necrolyte",
      "batrider",
      "bloodseeker",
      "silencer",
      "shadow_demon",
      "skywrath_mage",
      "pugna",
    ],
    items: ["sphere", "aeon_disk"],
  },
  {
    key: "passive",
    label: "pasif yetenek",
    reason: "Rakipte pasifi güçlü hero var",
    // Olcut: pasifi kirildiginda hero'nun ISE YARAMAZ hale geldigi durumlar.
    heroes: [
      "bristleback",
      "phantom_assassin",
      "dragon_knight",
      "spectre",
      "ursa",
      "sven",
      "juggernaut",
      "medusa",
      "faceless_void",
      "riki",
      "slark",
      "life_stealer",
      "tidehunter",
      "centaur",
      "shredder",
      "huskar",
      "sniper",
      "drow_ranger",
      "axe",
      "monkey_king",
      "night_stalker",
      "luna",
      "weaver",
      "viper",
      "phantom_lancer",
      "alchemist",
      "lycan",
      "templar_assassin",
    ],
    items: ["silver_edge", "angels_demise"],
  },
];

/** hero -> tasidigi tehdit anahtarlari. Bir kez kurulur. */
const THREATS_BY_HERO = (() => {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const threat of THREATS) {
    for (const hero of threat.heroes) {
      const key = normalizeHeroKey(hero);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(threat.key);
    }
  }
  return map;
})();

/** tehdit anahtari -> tanim. */
const THREAT_BY_KEY = new Map(THREATS.map((threat) => [threat.key, threat]));

/**
 * Bir takimin TASIDIGI tehditler.
 *
 * @param {Array<Record<string, any>>} rows Rakip satirlari
 * @returns {Array<{
 *   key: string,
 *   label: string,
 *   reason: string,
 *   items: string[],
 *   heroes: string[]
 * }>}
 */
export function detectThreats(rows) {
  /** @type {Map<string, Set<string>>} tehdit -> onu tasiyan hero'lar */
  const found = new Map();

  for (const row of rows || []) {
    const hero = normalizeHeroKey(row?.hero);
    if (!hero) {
      continue;
    }
    for (const key of THREATS_BY_HERO.get(hero) || []) {
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
    reason: threat.reason,
    items: threat.items.map(normalizeItemKey),
    heroes: [...found.get(threat.key)],
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

/**
 * Bir hero'nun tasidigi tehditler (arayuzde hero rozetleri icin).
 * @param {string} hero
 * @returns {string[]}
 */
export function heroThreats(hero) {
  return [...(THREATS_BY_HERO.get(normalizeHeroKey(hero)) || [])];
}

export { THREATS, THREAT_BY_KEY };
