/**
 * Sahte canli mac gonderir — masaustu uygulamasi ve Dota acmadan arayuzu
 * denemek icin.
 *
 * NEDEN VAR: canli mac paneli yalnizca GSI verisi geldiginde doluyor. Envanter
 * yerlesimini, item tavsiyesini ya da takim analizini gozle gormek icin normalde
 * oyuna girmek gerekiyor. Bu betik `/api/live` ucuna masaustu uygulamasinin
 * gonderecegi seklin AYNISINI gonderir; sunucu gercek bir mactan ayirt etmez.
 *
 * KULLANIM
 *   # once sunucuyu baslat (ayri bir terminalde)
 *   npm run dev:cloud
 *
 *   # sonra maci gonder
 *   node scripts/fake-live-match.mjs
 *
 *   # surekli guncel kalsin (kayit 3 dakika sonra bayatliyor)
 *   node scripts/fake-live-match.mjs --watch
 *
 * SECENEKLER
 *   --url <adres>   varsayilan http://localhost:8888
 *   --watch         10 saniyede bir yeniden gonderir, skor ve sure ilerler
 *   --empty         envanterleri bos birakir (oyun basi gorunumu)
 *   --enemy-hidden  rakip satirlarini Overwolf'suz kuruluma benzetir
 *                   (yalnizca hero bilinir, envanter alani HIC gelmez —
 *                   panelin "bos envanter" ile "envanter bilinmiyor"u ayirt
 *                   ettigini gormek icin)
 *
 * YETKI: `.env` icindeki `LIVE_INGEST_TOKEN` kullanilir. Tanimli degilse
 * `npm run dev:cloud` oturum cerezi de kabul ediyor, ama betik tarayici
 * olmadigi icin token yolunu kullanir.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeGsiPayload } from "../packages/core/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = option("--url", "http://localhost:8888").replace(/\/+$/, "");
const WATCH = flag("--watch");
const EMPTY = flag("--empty");
const ENEMY_HIDDEN = flag("--enemy-hidden");

/** Kac saniyede bir yeniden gonderilir (kayit 3 dakikada bayatliyor). */
const WATCH_INTERVAL_MS = 10_000;

/**
 * `.env` dosyasindan tek bir degiskeni okur.
 *
 * Tam bir .env cozumleyicisine gerek yok: yalnizca bir anahtar araniyor ve bu
 * betik hicbir yerde uretimde calismiyor.
 *
 * @param {string} key
 * @returns {string}
 */
function readEnv(key) {
  if (process.env[key]) {
    return String(process.env[key]);
  }
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const line = raw
      .split(/\r?\n/)
      .find((row) => row.trim().startsWith(key + "="));
    return line ? line.slice(line.indexOf("=") + 1).trim() : "";
  } catch {
    return "";
  }
}

/** Iki takimin kadrosu (gorseldeki maca yakin). */
const LINEUP = {
  radiant: [
    ["Mat`e Ball", "lina"],
    ["Mmm~ Ahh~", "dragon_knight"],
    ["Inquisitor", "keeper_of_the_light"],
    ["FEEDER POS 1", "shadow_shaman"],
    ["EZEL", "antimage"],
  ],
  dire: [
    ["Euva", "pudge"],
    ["Понтий Пират", "nevermore"],
    ["катя рэзвэдж", "lich"],
    ["котаев", "ember_spirit"],
    ["Millenium", "dawnbreaker"],
  ],
};

/**
 * Her oyuncuya farkli bir envanter: tek bir kalip, ikon ve yerlesim
 * hatalarini gizler.
 */
const INVENTORIES = [
  [
    "travel_boots",
    "sphere",
    "angels_demise",
    "cyclone",
    "bfury",
    "greater_crit",
  ],
  [
    "phase_boots",
    "blink",
    "black_king_bar",
    "ancient_janggo",
    "pipe",
    "assault",
  ],
  [
    "arcane_boots",
    "glimmer_cape",
    "force_staff",
    "gungir",
    "sheepstick",
    "ghost",
  ],
  ["power_treads", "manta", "butterfly", "satanic", "devastator", "skadi"],
  [
    "tranquil_boots",
    "mekansm",
    "solar_crest",
    "pavise",
    "lotus_orb",
    "aeon_disk",
  ],
];

/** Backpack icerikleri (uc slot, bazilari bilerek eksik). */
const BACKPACKS = [
  ["magic_wand", "wind_lace"],
  ["quelling_blade"],
  ["magic_wand", "dust", "smoke_of_deceit"],
  [],
  ["ward_dispenser"],
];

/** Neutral item + neutral etkisi ciftleri. */
const NEUTRALS = [
  ["trusty_shovel", "enhancement_vast"],
  ["vambrace", "enhancement_quickened"],
  ["pupils_gift", "enhancement_mystical"],
  ["mind_breaker", "enhancement_alert"],
  ["", ""],
];

/**
 * Tek bir oyuncunun GSI blogu.
 *
 * @param {Object} input
 * @param {number} input.tick Kacinci gonderim (skor/sure ilerlesin diye)
 * @param {string} input.team
 * @param {number} input.index Takim ici sira (0-4)
 * @param {boolean} input.hideInventory Envanter alani HIC gonderilmesin mi
 */
function playerBlock({ tick, team, index, hideInventory }) {
  const [name, hero] = LINEUP[team][index];
  const offset = team === "radiant" ? 0 : 5;

  const block = {
    steamid: "7656119800000000" + (offset + index),
    accountid: String(100000000 + offset * 10 + index),
    name,
    team_name: team,
    // Sayilar tick ile ilerliyor: panelin gercekten tazelendigi gorulsun.
    kills: 3 + index + Math.floor(tick / 3),
    deaths: 2 + ((index + tick) % 5),
    assists: 4 + index * 2,
    last_hits: 40 + index * 30 + tick * 4,
    denies: 2 + index,
    net_worth: 6000 + index * 1500 + tick * 120,
    gpm: 420 + index * 60,
    xpm: 500 + index * 55,
    hero: {
      name: "npc_dota_hero_" + hero,
      level: 12 + index,
      // Bazilarinda var bazilarinda yok: solaktaki iki kutunun dolu/bos
      // ayrimi gorunsun.
      aghanims_scepter: index % 2,
      aghanims_shard: (index + 1) % 2,
    },
  };

  // Overwolf'suz kurulumda rakip satirlarinda item alani HIC yoktur — bos
  // dizi degil, alanin kendisi yok. Panel bu ikisini ayirt ediyor.
  if (hideInventory) {
    return block;
  }

  const main = EMPTY ? [] : INVENTORIES[index];
  const backpack = EMPTY ? [] : BACKPACKS[index];
  const [neutral, enhancement] = EMPTY ? ["", ""] : NEUTRALS[index];

  /** @type {Record<string, { name: string }>} */
  const items = {};
  main.forEach((key, slot) => {
    items["slot" + slot] = { name: "item_" + key };
  });
  backpack.forEach((key, slot) => {
    items["slot" + (6 + slot)] = { name: "item_" + key };
  });
  if (!EMPTY) {
    items.teleport0 = { name: "item_tpscroll" };
  }
  if (neutral) {
    items.neutral0 = { name: "item_" + neutral };
  }
  if (enhancement) {
    items.neutral1 = { name: "item_" + enhancement };
  }

  block.items = items;
  return block;
}

/**
 * Bir gonderimlik ham GSI payload'u.
 * @param {number} tick
 */
function payload(tick) {
  /** @type {Record<string, any>} */
  const allplayers = {};
  for (const team of ["radiant", "dire"]) {
    for (let index = 0; index < 5; index += 1) {
      const key = "player" + (team === "radiant" ? index : index + 5);
      allplayers[key] = playerBlock({
        tick,
        team,
        index,
        hideInventory: ENEMY_HIDDEN && team === "dire",
      });
    }
  }

  return {
    provider: { name: "Dota 2", appid: 570, timestamp: Date.now() / 1000 },
    map: {
      matchid: "9000000001",
      game_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
      clock_time: 1200 + tick * 10,
      radiant_score: 18 + Math.floor(tick / 2),
      dire_score: 24 + Math.floor(tick / 3),
    },
    allplayers,
  };
}

/**
 * @param {number} tick
 */
async function send(tick) {
  const token = readEnv("LIVE_INGEST_TOKEN");

  // Uc hem ham GSI'yi hem normalize durumu kabul ediyor. Normalde ham gonderilir
  // (masaustu uygulamasinin yaptigi), ama `--enemy-hidden` icin durum burada
  // normalize edilip alanlar SILINIR: GSI her satira bos bir `items` dizisi
  // yaziyor, oysa Overwolf'tan gelen rakip satirlarinda o alan HIC yok. Ikisi
  // ayni sey degil ve panel de ayni sekilde davranmiyor.
  const body = { uploaderSteamId: "76561198000000000" };
  if (ENEMY_HIDDEN) {
    const state = normalizeGsiPayload(payload(tick));
    for (const row of state.direPlayers || []) {
      delete row.items;
      delete row.backpack;
      delete row.neutral;
      delete row.neutralEffect;
      delete row.tp;
      delete row.hasScepter;
      delete row.hasShard;
    }
    body.state = state;
  } else {
    body.raw = payload(tick);
  }

  const response = await fetch(BASE + "/api/live", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-dotastat-token": token } : {}),
    },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok === false) {
    throw new Error(
      "gonderilemedi (" +
        response.status +
        "): " +
        (result?.message || result?.error || "bilinmeyen hata"),
    );
  }
  return result;
}

async function main() {
  const first = await send(0);
  console.log("gonderildi -> " + BASE + "  mac: " + first.matchId);
  console.log("arayuz: " + BASE + "  (Canli Mac bolumu kendiliginden acilir)");

  if (!WATCH) {
    console.log(
      "\nKayit 3 dakika sonra bayatlar ve panel 'canli mac yok'a doner.\n" +
        "Acik kalmasi icin: node scripts/fake-live-match.mjs --watch",
    );
    return;
  }

  console.log(
    "\n--watch: " +
      WATCH_INTERVAL_MS / 1000 +
      " saniyede bir yenileniyor. Durdurmak icin Ctrl+C.",
  );
  let tick = 1;
  setInterval(() => {
    send(tick)
      .then(() => {
        process.stdout.write(".");
        tick += 1;
      })
      .catch((error) => console.error("\n" + String(error?.message || error)));
  }, WATCH_INTERVAL_MS);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  console.error("\nSunucu acik mi? Ayri bir terminalde: npm run dev:cloud");
  process.exitCode = 1;
});
