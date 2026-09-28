/**
 * Bir takimin pozisyon dagilimi: her pozisyondan TAM OLARAK BIR kisi.
 *
 * SORUN: rol tek tek oyuncunun istatistiginden cikariliyordu. Parse
 * edilmemis bir macta (lane verisi yok) GPM'i yuksek uc oyuncunun ucu de
 * "pos 1" oluyordu; iki destek de "pos 5". Oysa bir takimda her pozisyon
 * bir kez bulunur ve bu tek basina cok guclu bir kisit.
 *
 * YONTEM: takimdaki oyuncularla bes pozisyonun TUM eslesmeleri denenir
 * (en fazla 5! = 120) ve toplam "uyumsuzluk" maliyeti en dusuk olan secilir.
 *
 *   - Elle girilen pozisyon KESINDIR: o oyuncu baska pozisyona konamaz,
 *     o pozisyona da baskasi konamaz. Kalanlar geri kalan yerlere dagilir.
 *   - Farm sirasi (net worth / GPM, son vurus): pos 1-2 en cok, pos 5 en az
 *     farm alir.
 *   - Lane (saglayici verdiyse): mid -> pos 2; safe lane -> pos 1 ya da 5;
 *     off lane -> pos 3 ya da 4; roam -> pos 4.
 *   - Ward: en cok ward diken destek pos 5'e yakindir.
 *   - Itemler: destek itemleri (ward, Glimmer, Force...) core'u, farm
 *     itemleri (Battle Fury, Manta...) destegi zayiflatir.
 *   - Hero'nun oynandigi roller (hero katalogu): zayif bir ipucu.
 *
 * Kesin bir dogru yok; amac TUTARLI bir dagilim. SAF FONKSIYON.
 */

import { heroRecord } from "../heroes/hero-catalog.js";
import { normalizeHeroKey } from "../heroes/hero-names.js";
import { normalizeRoleKey } from "./player-types.js";

const POSITIONS = ["pos1", "pos2", "pos3", "pos4", "pos5"];

/** Hero katalogundaki lane rolu -> pozisyon. */
const LANE_ROLE_TO_POSITION = {
  carry: "pos1",
  mid: "pos2",
  offlane: "pos3",
  sup4: "pos4",
  sup5: "pos5",
};

/**
 * Saglayicinin lane bilgisi (OpenDota lane_role/is_roaming, `role` alanina
 * pos1/pos2/pos3/pos4 olarak yaziliyor) -> pozisyon basina maliyet.
 * Safe lane'de hem carry hem hard support durur; off lane'de offlaner ve
 * pos 4. Lane tek basina pozisyonu soylemez, farm sirasiyla birlikte soyler.
 */
const LANE_COST = {
  pos1: { pos1: 0, pos2: 3, pos3: 2.5, pos4: 2, pos5: 0.5 },
  pos2: { pos1: 3, pos2: 0, pos3: 3, pos4: 3, pos5: 3 },
  pos3: { pos1: 2.5, pos2: 3, pos3: 0, pos4: 0.5, pos5: 2 },
  pos4: { pos1: 2, pos2: 2, pos3: 1.5, pos4: 0, pos5: 0.8 },
};

/** Destek oyuncusunun aldigi itemler. */
const SUPPORT_ITEMS = new Set([
  "ward_observer",
  "ward_sentry",
  "ward_dispenser",
  "dust",
  "smoke_of_deceit",
  "gem",
  "glimmer_cape",
  "force_staff",
  "ghost",
  "arcane_boots",
  "tranquil_boots",
  "mekansm",
  "guardian_greaves",
  "pavise",
  "solar_crest",
  "holy_locket",
  "boots_of_bearing",
  "urn_of_shadows",
  "spirit_vessel",
  "aether_lens",
  "wind_waker",
  "lotus_orb",
]);

/** Core oyuncunun (bol farm) aldigi itemler. */
const CORE_ITEMS = new Set([
  "bfury",
  "manta",
  "butterfly",
  "satanic",
  "skadi",
  "radiance",
  "greater_crit",
  "hand_of_midas",
  "monkey_king_bar",
  "abyssal_blade",
  "disperser",
  "bloodthorn",
  "mjollnir",
  "heart",
  "assault",
  "desolator",
  "black_king_bar",
  "sange_and_yasha",
  "yasha_and_kaya",
  "kaya_and_sange",
  "moon_shard",
  "rapier",
]);

/**
 * @typedef {Object} RoleCandidate
 * @property {string} id           Satiri tanimlayan anahtar
 * @property {string} [hero]
 * @property {string} [forcedRole] Elle girilen pozisyon (kesin)
 * @property {string} [laneRole]   Saglayicinin lane tabanli rolu
 * @property {number} [gpm]
 * @property {number|null} [netWorth]
 * @property {number} [lastHits]
 * @property {number|null} [obsPlaced]
 * @property {number|null} [senPlaced]
 * @property {string[]} [items]
 */

/**
 * Bir takimin pozisyon dagilimi.
 *
 * @param {RoleCandidate[]} players En fazla 5 oyuncu (fazlasi yok sayilir)
 * @param {{ heroOverrides?: Record<string, Record<string, any>> }} [options]
 * @returns {Record<string, { role: string, source: "manual"|"team" }>}
 */
export function assignTeamRoles(players, options = {}) {
  const rows = (Array.isArray(players) ? players : [])
    .filter((row) => row && row.id)
    .slice(0, POSITIONS.length);
  if (!rows.length) {
    return {};
  }

  const farmRank = rankBy(rows, farmValue);
  const wardRank = rankBy(rows, (row) => wardTotal(row) ?? -1);
  const anyWards = rows.some((row) => (wardTotal(row) ?? 0) > 0);
  // Farm degerleri buyukten kucuge: "bu sirada olmasi gereken" oyuncunun
  // farmi. Siralama farki bu degerlerin ne kadar ayrildigina gore agirlanir.
  const farmValues = rows.map(farmValue).sort((a, b) => b - a);

  // Oyuncu x pozisyon maliyet tablosu.
  const cost = rows.map((row, index) =>
    POSITIONS.map((position) =>
      positionCost(row, position, {
        farmValue: farmValue(row),
        farmValues,
        farmRank: farmRank[index],
        wardRank: anyWards ? wardRank[index] : null,
        overrides: options.heroOverrides || {},
      }),
    ),
  );

  let best = { total: Infinity, picks: /** @type {number[]} */ ([]) };
  const used = new Array(POSITIONS.length).fill(false);
  const picks = [];

  // Tum eslesmeler: oyuncu sayisi <= 5 oldugu icin en fazla 120 dal.
  const search = (index, total) => {
    if (total >= best.total) {
      return;
    }
    if (index === rows.length) {
      best = { total, picks: [...picks] };
      return;
    }
    for (let position = 0; position < POSITIONS.length; position += 1) {
      if (used[position] || !Number.isFinite(cost[index][position])) {
        continue;
      }
      used[position] = true;
      picks.push(position);
      search(index + 1, total + cost[index][position]);
      picks.pop();
      used[position] = false;
    }
  };
  search(0, 0);

  // Elle girilen iki pozisyon cakisiyorsa (ayni pozisyon iki kisiye) gecerli
  // eslesme yoktur; o zaman elle girilenler yok sayilarak yeniden denenir.
  if (!best.picks.length) {
    return assignTeamRoles(
      rows.map((row) => ({ ...row, forcedRole: "" })),
      options,
    );
  }

  /** @type {Record<string, { role: string, source: "manual"|"team" }>} */
  const out = {};
  rows.forEach((row, index) => {
    const role = POSITIONS[best.picks[index]];
    out[row.id] = {
      role,
      source: normalizeRoleKey(row.forcedRole) === role ? "manual" : "team",
    };
  });
  return out;
}

/**
 * @param {RoleCandidate} row
 * @param {string} position
 * @param {{ farmValue: number, farmValues: number[], farmRank: number, wardRank: number|null, overrides: Record<string, any> }} context
 * @returns {number}
 */
function positionCost(row, position, context) {
  const forced = normalizeRoleKey(row.forcedRole);
  if (forced) {
    return forced === position ? 0 : Infinity;
  }

  const slot = POSITIONS.indexOf(position) + 1;
  let total = 0;

  // 1. Farm sirasi. Pos 1 ile pos 2 sik yer degistirir; ikisi de ilk iki
  //    sirada ise ceza yok.
  //    Sira farki, farmlarin GERCEKTEN ne kadar ayrildigina gore olceklenir:
  //    21k ile 18k net worth arasindaki iki sira, 32k ile 12k arasindaki iki
  //    siraya gore cok daha zayif bir kanit. Yakin farmda hero/lane ipucu
  //    karar verir.
  const top = context.farmValues?.[0] || 0;
  const expected =
    context.farmValues?.[Math.min(slot, context.farmValues.length) - 1] ?? 0;
  const separation =
    top > 0
      ? Math.min(1, (Math.abs(context.farmValue - expected) / top) * 5)
      : 1;
  const gap = Math.abs(context.farmRank - slot) * separation;
  const coreSwap = slot <= 2 && context.farmRank <= 2;
  // Iki destek arasindaki farm farki kucuk ve gurultulu; ayrimi ward
  // yapar, farm yalnizca zayif bir ipucu.
  const supportSwap = slot >= 4 && context.farmRank >= 4;
  total += coreSwap ? 0 : supportSwap ? gap * 0.4 : gap * 1.2;

  // 2. Lane.
  const lane = normalizeRoleKey(row.laneRole);
  if (lane && LANE_COST[lane]) {
    total += LANE_COST[lane][position] ?? 0;
  }

  // 3. Ward: en cok ward diken pos 5'e, ikinci pos 4'e yakin.
  if (context.wardRank !== null) {
    const wards = wardTotal(row) ?? 0;
    if (slot <= 3 && wards >= 6) {
      total += 2.5;
    }
    if (slot === 5) {
      total += Math.max(0, context.wardRank - 1) * 1.5;
    }
    if (slot === 4) {
      total += Math.max(0, context.wardRank - 2) * 0.4;
    }
  }

  // 4. Itemler.
  const items = (row.items || []).map((key) => String(key || ""));
  const supportItems = items.filter((key) => SUPPORT_ITEMS.has(key)).length;
  const coreItems = items.filter((key) => CORE_ITEMS.has(key)).length;
  if (slot <= 3) {
    total += Math.min(supportItems, 3) * 0.7;
  } else {
    total += Math.min(coreItems, 3) * 0.8;
  }

  // 5. Hero'nun oynandigi roller: zayif ipucu.
  const hero = normalizeHeroKey(row.hero);
  const record = hero
    ? heroRecord(hero, context.overrides?.[hero] || null)
    : null;
  const positions = (record?.laneRoles || [])
    .map((role) => LANE_ROLE_TO_POSITION[role])
    .filter(Boolean);
  if (positions.length && !positions.includes(position)) {
    const heroIsSupport = positions.every(
      (pos) => pos === "pos4" || pos === "pos5",
    );
    const heroIsCore = positions.every(
      (pos) => pos !== "pos4" && pos !== "pos5",
    );
    const mismatch = (heroIsSupport && slot <= 3) || (heroIsCore && slot >= 4);
    total += mismatch ? 1.5 : 0.6;
  }

  return total;
}

/**
 * Farm olcusu: net worth varsa o, yoksa GPM; esitlikte son vurus.
 * @param {RoleCandidate} row
 */
function farmValue(row) {
  const worth = Number(row.netWorth);
  const base =
    Number.isFinite(worth) && worth > 0 ? worth : Number(row.gpm || 0) * 40;
  return base + Number(row.lastHits || 0);
}

/** @param {RoleCandidate} row */
function wardTotal(row) {
  const obs = row.obsPlaced;
  const sen = row.senPlaced;
  if (
    (obs === null || obs === undefined) &&
    (sen === null || sen === undefined)
  ) {
    return null;
  }
  return Number(obs || 0) + Number(sen || 0);
}

/**
 * Buyukten kucuge sira (1 = en yuksek). Esitlikte satir sirasi.
 * @param {RoleCandidate[]} rows
 * @param {(row: RoleCandidate) => number} value
 * @returns {number[]}
 */
function rankBy(rows, value) {
  const order = rows
    .map((row, index) => ({ index, value: value(row) }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  const ranks = new Array(rows.length);
  order.forEach((entry, position) => {
    ranks[entry.index] = position + 1;
  });
  return ranks;
}

export { POSITIONS };
