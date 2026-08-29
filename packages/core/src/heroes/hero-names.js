/**
 * Hero anahtari normalizasyonu ve gorsel adresleri.
 *
 * Dota icinde bir kahramanin uc ayri adi olabiliyor:
 *   - dahili anahtar        : `npc_dota_hero_windrunner`
 *   - CDN dosya adi         : `windrunner`
 *   - oyundaki gorunen ad   : `Windranger`
 * Bu modul ucunu tek bir anahtara indirger ve gorsel URL'lerini uretir.
 */

import heroIds from "../data/hero-ids.js";
import heroRoles from "../data/hero-roles.js";

const HERO_CDN =
  "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";

/** Konusma dilinde / farkli kaynaklarda kullanilan adlarin karsiliklari. */
const HERO_ALIASES = {
  pa: "phantom_assassin",
  phantom_assasin: "phantom_assassin",
  qop: "queenofpain",
  queen_of_pain: "queenofpain",
  zeus: "zuus",
  earth_shaker: "earthshaker",
  shadow_fiend: "nevermore",
  wind_ranger: "windrunner",
  windranger: "windrunner",
  wraith_king: "skeleton_king",
  clockwerk: "rattletrap",
  timbersaw: "shredder",
  lifestealer: "life_stealer",
  outworld_destroyer: "obsidian_destroyer",
  outworld_devourer: "obsidian_destroyer",
  natures_prophet: "furion",
  magnus: "magnataur",
  underlord: "abyssal_underlord",
  blood_seeker: "bloodseeker",
  necrophos: "necrolyte",
  doom: "doom_bringer",
  treant_protector: "treant",
  centaur_warrunner: "centaur",
  vengeful_spirit: "vengefulspirit",
  storm: "storm_spirit",
  void: "faceless_void",
  brist: "bristleback",
  spectra: "spectre",
};

/** Anahtar ile CDN dosya adi ayrisan kahramanlar. */
const HERO_ICON_SLUG_ALIASES = {
  outworld_destroyer: "obsidian_destroyer",
  wraith_king: "skeleton_king",
  natures_prophet: "furion",
  shadow_fiend: "nevermore",
  timbersaw: "shredder",
  windranger: "windrunner",
  magnus: "magnataur",
  underlord: "abyssal_underlord",
  blood_seeker: "bloodseeker",
  necrophos: "necrolyte",
};

const HERO_NAME_BY_ID = new Map(
  Object.entries(heroIds).map(([id, key]) => [Number(id), String(key)]),
);

const HERO_ID_BY_NAME = new Map(
  Object.entries(heroIds).map(([id, key]) => [String(key), Number(id)]),
);

/**
 * Herhangi bir yazimi tek bir hero anahtarina indirger.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeHeroKey(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^npc_dota_hero_/, "")
    .replace(/[.'`]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  return HERO_ALIASES[base] || base;
}

/**
 * @param {number|string} heroId
 * @returns {string}
 */
export function heroKeyFromId(heroId) {
  return HERO_NAME_BY_ID.get(Number(heroId)) || "";
}

/**
 * @param {string} heroKey
 * @returns {number}
 */
export function heroIdFromKey(heroKey) {
  return HERO_ID_BY_NAME.get(normalizeHeroKey(heroKey)) || 0;
}

/**
 * Okunabilir hero adi: `phantom_assassin` -> `Phantom Assassin`
 * @param {string} heroKey
 * @returns {string}
 */
export function heroDisplayName(heroKey) {
  const key = normalizeHeroKey(heroKey);
  if (!key) {
    return "";
  }
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Steam CDN uzerindeki hero gorseli. Statik asset'tir, API limiti tuketmez.
 * @param {string} heroKey
 * @param {"icon"|"portrait"} [variant]
 * @returns {string}
 */
export function heroImageUrl(heroKey, variant = "icon") {
  const key = normalizeHeroKey(heroKey);
  if (!key) {
    return "";
  }
  const slug = HERO_ICON_SLUG_ALIASES[key] || key;
  return variant === "portrait"
    ? `${HERO_CDN}/${slug}.png`
    : `${HERO_CDN}/icons/${slug}.png`;
}

/**
 * Hero'nun rol/lane profili (yerel tablo, ag istegi yok).
 * @param {string} heroKey
 * @returns {{ primaryRole: string, roles: string[], lane: string, counters: string[], counteredBy: string[], synergyWith: string[] }|null}
 */
export function heroRoleProfile(heroKey) {
  const key = normalizeHeroKey(heroKey);
  const row = heroRoles[key];
  if (!row) {
    return null;
  }
  return {
    primaryRole: String(row.primaryRole || ""),
    roles: Array.isArray(row.roles) ? row.roles : [],
    lane: String(row.lane || ""),
    counters: Array.isArray(row.counters) ? row.counters : [],
    counteredBy: Array.isArray(row.counteredBy) ? row.counteredBy : [],
    synergyWith: Array.isArray(row.synergyWith) ? row.synergyWith : [],
  };
}

export { HERO_ALIASES, HERO_ICON_SLUG_ALIASES, HERO_CDN };
