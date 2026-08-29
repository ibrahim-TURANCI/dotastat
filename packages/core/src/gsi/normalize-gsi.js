/**
 * Dota 2 Game State Integration (GSI) payload'unu uygulamanin kullandigi
 * sade "canli mac" seklinde donusturur.
 *
 * Dota surumden surume ve istemciden istemciye farkli sekiller gonderebiliyor
 * (allplayers yoksa player/hero ikilisi, takim bilgisi bazen isim bazen id).
 * Bu modul tum bu varyantlari tek bir sekle indirger.
 */

import { normalizeHeroKey } from "../heroes/hero-names.js";

/** Draft'in acik oldugu oyun fazlari. */
const DRAFT_LIKE_PHASES = [
  "HERO_SELECTION",
  "STRATEGY_TIME",
  "PRE_GAME",
  "GAME_IN_PROGRESS",
];

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeItemName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^item_/, "");
}

/**
 * Item slotlarini ana envanter / sirt cantasi / TP / neutral olarak ayirir.
 * @param {Record<string, any>} itemsObj
 */
function extractItems(itemsObj) {
  const layout = {
    main: [],
    backpack: [],
    tp: "",
    neutral: "",
    all: [],
  };

  for (const [rawKey, rawValue] of Object.entries(itemsObj || {})) {
    if (!rawValue) {
      continue;
    }

    const itemName = normalizeItemName(rawValue?.name || rawValue || "");
    if (
      !itemName ||
      itemName === "empty" ||
      itemName === "recipe" ||
      itemName.startsWith("recipe_")
    ) {
      continue;
    }

    const slot = Number.parseInt(String(rawKey).replace(/\D+/g, ""), 10);
    const isStash = /stash/i.test(rawKey);
    const isTeleport = /teleport/i.test(rawKey);
    const isNeutral = /neutral/i.test(rawKey);
    const isBackpack = /backpack/i.test(rawKey);

    if (isNeutral || slot === 16) {
      layout.neutral = itemName;
    } else if (isTeleport || slot === 15) {
      layout.tp = itemName;
    } else if (isBackpack || (slot >= 6 && slot <= 8)) {
      layout.backpack.push(itemName);
    } else if (!isStash) {
      layout.main.push(itemName);
    }

    layout.all.push(itemName);
  }

  return layout;
}

/**
 * @param {Record<string, any>} player
 * @param {string} key
 * @returns {"radiant"|"dire"|""}
 */
function inferTeam(player, key = "") {
  const rawTeam = String(
    player?.team_name || player?.team || player?.team_id || "",
  ).toLowerCase();

  if (
    rawTeam.includes("radiant") ||
    rawTeam === "2" ||
    rawTeam === "team2" ||
    rawTeam === "goodguys" ||
    rawTeam === "dota_team_goodguys"
  ) {
    return "radiant";
  }
  if (
    rawTeam.includes("dire") ||
    rawTeam === "3" ||
    rawTeam === "team3" ||
    rawTeam === "badguys" ||
    rawTeam === "dota_team_badguys"
  ) {
    return "dire";
  }

  const slot = Number.parseInt(String(key).replace(/\D+/g, ""), 10);
  if (Number.isFinite(slot)) {
    return slot <= 4 ? "radiant" : "dire";
  }
  return "";
}

/**
 * Takim ici 1..5 slot numarasi.
 * @param {Record<string, any>} player
 * @param {string} key
 * @returns {number|null}
 */
function inferTeamSlot(player, key = "") {
  const candidates = [
    player?.slot,
    player?.team_slot,
    player?.player_slot,
    key,
  ];
  for (const candidate of candidates) {
    const raw = Number.parseInt(String(candidate).replace(/\D+/g, ""), 10);
    if (!Number.isFinite(raw)) {
      continue;
    }
    if (raw >= 0 && raw <= 4) {
      return raw + 1;
    }
    if (raw >= 5 && raw <= 9) {
      return raw - 4;
    }
  }
  return null;
}

/**
 * Hero alani surume gore ya duz metin ya da `{ name, level }` nesnesi gelir.
 * Nesne gelip `name` bos oldugunda nesnenin kendisi metne cevrilirse
 * "[object Object]" olusur; bu yuzden tur kontrolu yapilir.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readHeroName(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && typeof value.name === "string") {
    return value.name;
  }
  return "";
}

/**
 * @param {Record<string, any>} raw ham GSI payload'u
 * @returns {Array<Record<string, any>>}
 */
function extractPlayers(raw) {
  const container = raw?.allplayers || {};
  const players = [];

  for (const [key, player] of Object.entries(container)) {
    const team = inferTeam(player, key);
    if (!team) {
      continue;
    }

    const items = extractItems(player?.items || {});
    players.push({
      slotKey: key,
      steamId: String(player?.steamid || ""),
      accountId: String(player?.accountid || ""),
      name: String(player?.name || "Player " + key),
      team,
      slot: inferTeamSlot(player, key),
      hero: normalizeHeroKey(readHeroName(player?.hero)),
      level: Number(player?.level || player?.hero?.level || 0),
      kills: Number(player?.kills || 0),
      deaths: Number(player?.deaths || 0),
      assists: Number(player?.assists || 0),
      lastHits: Number(player?.last_hits || 0),
      denies: Number(player?.denies || 0),
      netWorth: Number(player?.net_worth || player?.gold || 0),
      gpm: Number(player?.gpm || 0),
      xpm: Number(player?.xpm || 0),
      items: items.main,
      backpack: items.backpack,
      neutral: items.neutral,
    });
  }

  // Bazi istemcilerde allplayers gelmez; en azindan yerel oyuncu gosterilir.
  if (players.length === 0 && raw?.player && raw?.hero) {
    const items = extractItems(raw?.items || {});
    players.push({
      slotKey: "0",
      steamId: String(raw?.player?.steamid || ""),
      accountId: String(raw?.player?.accountid || ""),
      name: String(raw?.player?.name || "Local Player"),
      team: inferTeam(raw.player, "0") || "radiant",
      slot: inferTeamSlot(raw.player, "0"),
      hero: normalizeHeroKey(readHeroName(raw?.hero)),
      level: Number(raw?.hero?.level || 0),
      kills: Number(raw?.player?.kills || 0),
      deaths: Number(raw?.player?.deaths || 0),
      assists: Number(raw?.player?.assists || 0),
      lastHits: Number(raw?.player?.last_hits || 0),
      denies: Number(raw?.player?.denies || 0),
      netWorth: Number(raw?.player?.net_worth || raw?.player?.gold || 0),
      gpm: Number(raw?.player?.gpm || 0),
      xpm: Number(raw?.player?.xpm || 0),
      items: items.main,
      backpack: items.backpack,
      neutral: items.neutral,
    });
  }

  return players;
}

/**
 * GSI draft blogu: team2 = radiant, team3 = dire.
 * @param {Record<string, any>} raw
 */
function extractDraft(raw) {
  const picks = [];
  const bans = [];
  const draft = raw?.draft || {};
  const phase = String(raw?.map?.game_state || "").toUpperCase();

  if (!DRAFT_LIKE_PHASES.some((candidate) => phase.includes(candidate))) {
    return { picks: [], bans: [], activeTeam: "" };
  }

  const teamMap = [
    { data: draft.team2, team: "radiant" },
    { data: draft.team3, team: "dire" },
  ];

  let activeTeam = "";
  for (const entry of teamMap) {
    const teamData = entry.data;
    if (!teamData || typeof teamData !== "object") {
      continue;
    }
    if (teamData.pick === true) {
      activeTeam = entry.team;
    }
    for (let i = 0; i < 10; i += 1) {
      const pickClass = teamData["pick" + i + "_class"];
      if (pickClass) {
        const hero = normalizeHeroKey(pickClass);
        if (hero) {
          picks.push({ hero, team: entry.team });
        }
      }
      const banClass = teamData["ban" + i + "_class"];
      if (banClass) {
        const hero = normalizeHeroKey(banClass);
        if (hero) {
          bans.push({ hero, team: entry.team });
        }
      }
    }
  }

  return { picks, bans, activeTeam };
}

/**
 * Ham GSI payload'unu canli mac seklinde donusturur.
 * @param {Record<string, any>} raw
 */
export function normalizeGsiPayload(raw) {
  const players = extractPlayers(raw);
  const radiantPlayers = players.filter((row) => row.team === "radiant");
  const direPlayers = players.filter((row) => row.team === "dire");
  const draft = extractDraft(raw);

  // Draft blogu bos kalsa bile secilmis hero'lar oyuncu listesinden turetilir.
  if (draft.picks.length === 0) {
    for (const player of players) {
      if (player.hero) {
        draft.picks.push({ hero: player.hero, team: player.team });
      }
    }
  }

  return {
    matchId: String(raw?.map?.matchid || ""),
    phase: String(raw?.map?.game_state || "unknown"),
    gameTime: Number(raw?.map?.clock_time || raw?.map?.game_time || 0),
    radiantScore: Number(raw?.map?.radiant_score || 0),
    direScore: Number(raw?.map?.dire_score || 0),
    daytime: Boolean(raw?.map?.daytime),
    radiantPlayers,
    direPlayers,
    draft,
    localSteamId: String(raw?.player?.steamid || ""),
    updatedAt: new Date().toISOString(),
  };
}

export { extractDraft, extractPlayers, extractItems, DRAFT_LIKE_PHASES };
