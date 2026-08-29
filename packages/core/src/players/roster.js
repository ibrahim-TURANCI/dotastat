/**
 * Arkadas grubunun oyuncu listesi (roster).
 *
 * Dosya sistemine dokunmaz: tohum veri (`data/players.seed.js`) normalize
 * edilerek bellekte tutulur. Boylece ayni modul hem Netlify Function'da,
 * hem Electron'da, hem de tarayicida calisir.
 */

import playersSeed from "../data/players.seed.js";
import synergiesSeed from "../data/synergies.seed.js";
import { normalizePlayer, normalizeSynergy } from "./player-normalizer.js";

/** @type {import("./player-types.js").Player[]} */
const ROSTER = Object.freeze(
  (Array.isArray(playersSeed?.players) ? playersSeed.players : [])
    .map((row) => normalizePlayer(row, { source: "seed" }))
    .filter(Boolean),
);

/** @type {import("./player-types.js").PlayerSynergy[]} */
const SYNERGIES = Object.freeze(
  (Array.isArray(synergiesSeed?.synergies) ? synergiesSeed.synergies : [])
    .map((row) => normalizeSynergy(row))
    .filter(Boolean),
);

/**
 * @returns {import("./player-types.js").Player[]}
 */
export function listRoster() {
  return ROSTER.filter((player) => player.active !== false);
}

/**
 * @returns {import("./player-types.js").Player[]}
 */
export function listAllRoster() {
  return [...ROSTER];
}

/**
 * Slug (`janissary`), account id (`201008262`) veya SteamID64 ile arar.
 * @param {string|number} identifier
 * @returns {import("./player-types.js").Player|null}
 */
export function findRosterPlayer(identifier) {
  const raw = String(identifier || "").trim();
  if (!raw) {
    return null;
  }
  const accountId = toAccountId(raw);
  return (
    ROSTER.find(
      (player) =>
        player.id === raw ||
        player.player_id === raw ||
        (accountId && player.player_id === accountId),
    ) || null
  );
}

/**
 * @returns {import("./player-types.js").PlayerSynergy[]}
 */
export function listSynergies() {
  return [...SYNERGIES];
}

/**
 * @param {string} playerId
 * @returns {import("./player-types.js").PlayerSynergy[]}
 */
export function listSynergiesForPlayer(playerId) {
  const key = String(playerId || "");
  return SYNERGIES.filter(
    (row) => row.playerId1 === key || row.playerId2 === key,
  );
}

/**
 * SteamID64 -> 32-bit account id. Zaten 32-bit ise oldugu gibi doner.
 * @param {string|number} value
 * @returns {string}
 */
export function toAccountId(value) {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw)) {
    return "";
  }
  if (raw.length >= 17) {
    return String(BigInt(raw) - 76561197960265728n);
  }
  return raw;
}

/**
 * 32-bit account id -> SteamID64.
 * @param {string|number} value
 * @returns {string}
 */
export function toSteamId64(value) {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw)) {
    return "";
  }
  if (raw.length >= 17) {
    return raw;
  }
  return String(BigInt(raw) + 76561197960265728n);
}
