/**
 * Arkadas grubunun oyuncu listesi (roster).
 *
 * Dosya sistemine dokunmaz: tohum veri (`data/players.seed.js`) normalize
 * edilerek bellekte tutulur. Boylece ayni modul hem Netlify Function'da,
 * hem Electron'da, hem de tarayicida calisir.
 *
 * KADRO DEGISIKLIKLERI
 * --------------------
 * Tohum verinin uzerine bir DEGISIKLIK KATMANI uygulanir (Debug panelindeki
 * "Onbellek" tablosu): eklenen oyuncular, ad / account id duzenlemeleri,
 * gizlenenler ve silinenler. Katman tek bir kayitta durur (sitede Netlify
 * Blobs, masaustunde siteden okunan kopya) ve cagiran taraf onu
 * `applyRosterOverrides` ile yukler; asagidaki okuma fonksiyonlari senkron
 * kalir.
 *
 * GIZLI oyuncu `active: false` olur: Oyuncu Degerlendirme ekranindan cikar
 * (`listRoster`) ama `findRosterPlayer` onu bulmaya devam eder; kimlik,
 * yetki ve canli mac eslesmesi bozulmaz.
 */

import playersSeed from "../data/players.seed.js";
import synergiesSeed from "../data/synergies.seed.js";
import {
  buildPlayerSlug,
  normalizePlayer,
  normalizeSynergy,
} from "./player-normalizer.js";

/** @type {import("./player-types.js").Player[]} */
const SEED_ROSTER = Object.freeze(
  (Array.isArray(playersSeed?.players) ? playersSeed.players : [])
    .map((row) => normalizePlayer(row, { source: "seed" }))
    .filter(Boolean),
);

/** Katmanla eklenebilecek en fazla oyuncu (kotuye kullanimi sinirlar). */
const MAX_ADDED_PLAYERS = 40;

/**
 * @typedef {Object} RosterOverrides
 * @property {Array<{ id: string, name: string, player_id: string, createdAt: string }>} added
 * @property {Record<string, { name?: string, player_id?: string }>} edits Tohum oyuncularin duzenlemeleri
 * @property {string[]} hidden
 * @property {string[]} deleted Silinen TOHUM oyuncular
 */

/** @returns {RosterOverrides} */
function emptyOverrides() {
  return { added: [], edits: {}, hidden: [], deleted: [] };
}

/**
 * @param {unknown} values
 * @returns {string[]}
 */
function idList(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || "").trim()))].filter(
        Boolean,
      )
    : [];
}

/**
 * Disaridan gelen (depodan okunan) katmani guvenli bicime getirir.
 *
 * @param {unknown} input
 * @returns {RosterOverrides}
 */
export function normalizeRosterOverrides(input) {
  const source = input && typeof input === "object" ? input : {};

  const added = [];
  const seen = new Set();
  for (const row of Array.isArray(source.added) ? source.added : []) {
    const player = normalizePlayer(row, { source: "manual" });
    if (!player || seen.has(player.id) || seen.has(player.player_id)) {
      continue;
    }
    seen.add(player.id);
    seen.add(player.player_id);
    added.push({
      id: player.id,
      name: player.name,
      player_id: player.player_id,
      createdAt: player.createdAt,
    });
  }

  /** @type {RosterOverrides["edits"]} */
  const edits = {};
  const rawEdits =
    source.edits && typeof source.edits === "object" ? source.edits : {};
  for (const [id, edit] of Object.entries(rawEdits)) {
    const name = String(edit?.name || "").trim();
    const playerId = toAccountId(edit?.player_id);
    if (name || playerId) {
      edits[id] = {
        ...(name ? { name } : {}),
        ...(playerId ? { player_id: playerId } : {}),
      };
    }
  }

  return {
    added: added.slice(0, MAX_ADDED_PLAYERS),
    edits,
    hidden: idList(source.hidden),
    deleted: idList(source.deleted),
  };
}

/**
 * Tohum + katman -> gecerli kadro.
 *
 * @param {RosterOverrides} overrides
 * @returns {import("./player-types.js").Player[]}
 */
function buildRoster(overrides) {
  const deleted = new Set(overrides.deleted);
  const hidden = new Set(overrides.hidden);
  const seed = SEED_ROSTER.filter((player) => !deleted.has(player.id)).map(
    (player) => {
      const edit = overrides.edits[player.id];
      return edit ? { ...player, ...edit } : player;
    },
  );
  const taken = new Set(seed.map((player) => player.player_id));
  const added = overrides.added
    .map((row) => normalizePlayer(row, { source: "manual" }))
    .filter((player) => player && !taken.has(player.player_id));

  return Object.freeze(
    [...seed, ...added].map((player) =>
      Object.freeze(
        hidden.has(player.id) ? { ...player, active: false } : player,
      ),
    ),
  );
}

/** @type {RosterOverrides} */
let OVERRIDES = emptyOverrides();
/** @type {import("./player-types.js").Player[]} */
let ROSTER = buildRoster(OVERRIDES);

/**
 * Kadro degisiklik katmanini yukler. Bos/gecersiz girdi tohum veriye doner.
 *
 * @param {unknown} input
 * @returns {RosterOverrides} normalize edilmis katman
 */
export function applyRosterOverrides(input) {
  OVERRIDES = normalizeRosterOverrides(input);
  ROSTER = buildRoster(OVERRIDES);
  return OVERRIDES;
}

/** @returns {RosterOverrides} su an uygulanan katman */
export function getRosterOverrides() {
  return OVERRIDES;
}

/**
 * Bir kadro islemini katmana uygular (saf fonksiyon; kaydetmek cagiranin
 * isi). Site ve masaustu ayni kurallari paylassin diye burada.
 *
 *   { action: "add", accountId, name }
 *   { action: "edit", id, name?, accountId? }
 *   { action: "hide" | "show" | "delete", id }
 *
 * `catalogAdmin` oyuncu silinemez ve account id'si degistirilemez: yetki ona
 * bagli; yanlislikla kilitlenmek geri donusu zor bir durum olurdu.
 *
 * @param {unknown} input Mevcut katman
 * @param {Record<string, any>} change
 * @returns {{ ok: true, overrides: RosterOverrides } | { ok: false, error: string, message: string }}
 */
export function applyRosterChange(input, change) {
  const current = normalizeRosterOverrides(input);
  const roster = buildRoster(current);
  const action = String(change?.action || "");
  const fail = (error, message) => ({ ok: false, error, message });
  const next = {
    added: [...current.added],
    edits: { ...current.edits },
    hidden: [...current.hidden],
    deleted: [...current.deleted],
  };

  if (action === "add") {
    const accountId = toAccountId(change?.accountId);
    const name = String(change?.name || "").trim();
    if (!accountId) {
      return fail("gecersiz-account-id", "Geçerli bir Account ID gir.");
    }
    if (!name) {
      return fail("isim-yok", "Oyuncu adı boş olamaz.");
    }
    const existing = roster.find((row) => row.player_id === accountId);
    if (existing) {
      return fail(
        "oyuncu-zaten-var",
        "Bu Account ID kadroda zaten var: " + existing.name,
      );
    }
    if (next.added.length >= MAX_ADDED_PLAYERS) {
      return fail("cok-fazla-oyuncu", "Daha fazla oyuncu eklenemez.");
    }
    // Silinmis tohum oyuncunun slug'i da dolu sayilir: geri eklenirse eski
    // duzenleme kayitlari yeni oyuncuya yapismasin.
    const ids = new Set([
      ...roster.map((row) => row.id),
      ...SEED_ROSTER.map((row) => row.id),
    ]);
    let id = buildPlayerSlug(name, accountId);
    if (ids.has(id)) {
      id = "player-" + accountId;
    }
    next.added.push({
      id,
      name,
      player_id: accountId,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, overrides: normalizeRosterOverrides(next) };
  }

  const id = String(change?.id || "").trim();
  const player = roster.find((row) => row.id === id);
  if (!player) {
    return fail("oyuncu-bulunamadi", "Oyuncu bulunamadı.");
  }

  if (action === "edit") {
    const name =
      change?.name === undefined ? player.name : String(change.name).trim();
    const accountId =
      change?.accountId === undefined
        ? player.player_id
        : toAccountId(change.accountId);
    if (!name) {
      return fail("isim-yok", "Oyuncu adı boş olamaz.");
    }
    if (!accountId) {
      return fail("gecersiz-account-id", "Geçerli bir Account ID gir.");
    }
    if (accountId !== player.player_id) {
      if (player.catalogAdmin) {
        return fail(
          "yonetici-korumali",
          "Katalog yöneticisinin Account ID değeri değiştirilemez.",
        );
      }
      const clash = roster.find(
        (row) => row.id !== id && row.player_id === accountId,
      );
      if (clash) {
        return fail(
          "oyuncu-zaten-var",
          "Bu Account ID başka bir oyuncuda: " + clash.name,
        );
      }
    }
    const index = next.added.findIndex((row) => row.id === id);
    if (index >= 0) {
      next.added[index] = { ...next.added[index], name, player_id: accountId };
    } else {
      const seed = SEED_ROSTER.find((row) => row.id === id);
      const edit = {
        ...(name !== seed?.name ? { name } : {}),
        ...(accountId !== seed?.player_id ? { player_id: accountId } : {}),
      };
      if (Object.keys(edit).length) {
        next.edits[id] = edit;
      } else {
        delete next.edits[id];
      }
    }
  } else if (action === "hide") {
    next.hidden = [...new Set([...next.hidden, id])];
  } else if (action === "show") {
    next.hidden = next.hidden.filter((row) => row !== id);
  } else if (action === "delete") {
    if (player.catalogAdmin) {
      return fail(
        "yonetici-korumali",
        "Katalog yöneticisi kadrodan silinemez.",
      );
    }
    next.added = next.added.filter((row) => row.id !== id);
    if (SEED_ROSTER.some((row) => row.id === id)) {
      next.deleted = [...new Set([...next.deleted, id])];
    }
    delete next.edits[id];
    next.hidden = next.hidden.filter((row) => row !== id);
  } else {
    return fail("gecersiz-islem", "Bilinmeyen kadro işlemi.");
  }

  return { ok: true, overrides: normalizeRosterOverrides(next) };
}

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
 * Tavsiye katalogundaki duzenlemeleri VARSAYILAN olarak kaydedebilir mi?
 *
 * Kadrodaki herkes katalogu duzenleyebilir; duzenlemeleri kalici varsayilana
 * cevirmek ise yalnizca `catalogAdmin` isaretli oyuncunun isidir (bkz.
 * data/players.seed.js).
 *
 * @param {string|number} identifier Slug, account id ya da SteamID64
 * @returns {boolean}
 */
export function isCatalogAdmin(identifier) {
  return Boolean(findRosterPlayer(identifier)?.catalogAdmin);
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
