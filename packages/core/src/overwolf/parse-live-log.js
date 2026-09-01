/**
 * Overwolf / DotaPlus loglarindan CANLI mac bilgisi cikarir.
 *
 * NEDEN VAR
 * ---------
 * Dota'nin GSI cikisi, sen oynarken YALNIZCA kendi oyuncu blogunu gonderir.
 * Rakip takimin (ve takim arkadaslarinin) hangi hero'yu sectigi GSI'da yoktur;
 * mac izlerken gelir, canli oynarken gelmez.
 *
 * Overwolf'un oyun-olay saglayicisi bu bilgiye erisiyor ve uzerinde calisan
 * DotaPlus uygulamasi onu kendi duz metin loguna yaziyor. Burasi o loglari
 * okuyup uygulamanin anladigi sekle cevirir. Dota'ya, bellege veya baska bir
 * surece DOKUNULMAZ — yalnizca dosya okumasi yapilir.
 *
 * OLCULEN GERCEKLER (27 Agustos - 1 Eylul 2026 loglari, 24 mac)
 * -------------------------------------------------------------
 * - Ranked macta Dota isim ve steamId'yi GIZLER (`anonymous=true`). Bu yuzden
 *   canli macta kimlik degil, YALNIZCA hero + rank + rol alinabilir.
 * - Hero secimleri her slot icin ayri ayri, saniyesinde loglanir.
 * - `isTraversal: true` = oyuncu hero'nun uzerinde geziniyor, HENUZ SECMEDI.
 * - Rank bilgisi controller logunda degil, DotaPlusObject logunda durur.
 *
 * KIRILGANLIK: bu bir API degil, baska bir urunun ic log bicimidir. Bicim
 * degisirse ayristirma sessizce bosa duser; uygulamanin geri kalani GSI ile
 * calismaya devam eder. Bu modul HICBIR ZAMAN istisna atmamalidir.
 */

import { heroKeyFromId, normalizeHeroKey } from "../heroes/hero-names.js";

/** `player_index` 0-4 Radiant, 5-9 Dire. Dota'nin slot duzeni budur. */
export function teamFromPlayerIndex(index) {
  const slot = Number(index);
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) {
    return "";
  }
  return slot <= 4 ? "radiant" : "dire";
}

/** Takim ici 1..5 slot numarasi (GSI tarafiyla ayni sayim). */
export function teamSlotFromPlayerIndex(index) {
  const slot = Number(index);
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) {
    return null;
  }
  return (slot % 5) + 1;
}

/**
 * DotaPlus zaman damgasi yereldir (saat dilimi yazmaz), bu yuzden yerel saat
 * olarak yorumlanip ISO'ya cevrilir. Iki log ailesi iki ayirac kullaniyor:
 * controller `,245`, object `.5452`.
 */
const TIMESTAMP = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})[,.](\d+)/;

/**
 * @param {string} line
 * @returns {string} ISO zaman veya bos metin
 */
export function parseLogTimestamp(line) {
  const match = TIMESTAMP.exec(String(line || ""));
  if (!match) {
    return "";
  }
  const [, year, month, day, hour, minute, second, fraction] = match;
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    // Controller milisaniye (3 hane), object 1/10000 saniye (4 hane) yazar.
    Number(String(fraction).slice(0, 3)),
  );
  return Number.isFinite(at.getTime()) ? at.toISOString() : "";
}

/**
 * Satirin belirtilen isaretten sonraki JSON parcasini okur.
 * Log satiri kirpilmis olabilir; o zaman sessizce `null` doner.
 *
 * @param {string} line
 * @param {string} marker
 * @returns {any}
 */
function readJsonAfter(line, marker) {
  const at = line.indexOf(marker);
  if (at < 0) {
    return null;
  }
  const rest = line.slice(at + marker.length).trim();
  const start = rest.search(/[[{]/);
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(rest.slice(start));
  } catch {
    return null;
  }
}

/** Bos bir canli mac goruntusu. */
function emptySnapshot() {
  return {
    source: "overwolf",
    matchId: "",
    activity: "",
    gameMode: "",
    ranked: false,
    myTeam: "",
    mySlot: null,
    matchState: "",
    ended: false,
    winner: "",
    picks: [],
    bans: [],
    players: [],
    partySteamIds: [],
    at: "",
  };
}

/**
 * Hero id'sini uygulamanin kullandigi anahtara cevirir.
 * @param {unknown} heroId
 * @returns {string}
 */
function heroKey(heroId) {
  const id = Number(heroId);
  if (!Number.isFinite(id) || id <= 0) {
    return "";
  }
  return normalizeHeroKey(heroKeyFromId(id) || "");
}

const LINE_DETECTING =
  /matchStore: Detecting match (\d+) - (\S+) - (\w+) - (\w+)/;
const LINE_DETECTED_SIDE =
  /matchStore: \[DD\] Detected playing: (\d+) (radiant|dire)/;
const LINE_DETECTED_WATCHING =
  /matchStore: \[DD\] Detected (spectating|coaching): (\d+)/;
const LINE_HERO_PICKED =
  /matchStore: Hero picked: index: (\d+), isMe: (true|false), id: (\d+), isTraversal: (true|false)/;
const LINE_MATCH_ENDED =
  /matchStore: Match (\d+) ended\. Winner is (Radiant|Dire)/i;
const LINE_MATCH_STATE = /matchStore: Match state changed: (\S+)/;

/**
 * `controller.html*.log` ayristirmasi: hero secimleri, banlar, mac kimligi.
 *
 * Dosyada BIRDEN FAZLA mac bulunur; yeni bir mac tespit edildiginde durum
 * sifirlanir, boylece sonuc her zaman EN SON macin goruntusudur.
 *
 * @param {string} text
 * @returns {ReturnType<typeof emptySnapshot>}
 */
export function parseDotaPlusControllerLog(text) {
  let snapshot = emptySnapshot();
  /** @type {Map<number, { heroId: number, confirmed: boolean }>} */
  let picks = new Map();
  let bans = [];
  /** @type {Array<Record<string, any>>} */
  let roster = [];
  let matchState = "";

  const reset = () => {
    snapshot = emptySnapshot();
    picks = new Map();
    bans = [];
    roster = [];
    matchState = "";
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.includes("matchStore:")) {
      continue;
    }

    const detecting = LINE_DETECTING.exec(line);
    if (detecting) {
      const [, matchId, gameMode, activity, ranked] = detecting;
      // Ayni mac yeniden tespit edilebilir (uygulama yeniden baslarsa);
      // o zaman biriken pick'ler korunur.
      if (matchId !== snapshot.matchId) {
        reset();
      }
      snapshot.matchId = matchId;
      snapshot.gameMode = gameMode;
      snapshot.activity = activity;
      snapshot.ranked = ranked.toLowerCase() === "ranked";
      snapshot.at = parseLogTimestamp(line) || snapshot.at;
      continue;
    }

    const side = LINE_DETECTED_SIDE.exec(line);
    if (side) {
      if (snapshot.matchId && side[1] !== snapshot.matchId) {
        reset();
      }
      snapshot.matchId = side[1];
      snapshot.activity = "playing";
      snapshot.myTeam = side[2];
      snapshot.at = parseLogTimestamp(line) || snapshot.at;
      continue;
    }

    const watching = LINE_DETECTED_WATCHING.exec(line);
    if (watching) {
      if (snapshot.matchId && watching[2] !== snapshot.matchId) {
        reset();
      }
      snapshot.matchId = watching[2];
      snapshot.activity = watching[1];
      snapshot.at = parseLogTimestamp(line) || snapshot.at;
      continue;
    }

    const picked = LINE_HERO_PICKED.exec(line);
    if (picked) {
      const index = Number(picked[1]);
      const isMe = picked[2] === "true";
      const heroId = Number(picked[3]);
      const traversal = picked[4] === "true";

      if (isMe) {
        snapshot.mySlot = index;
      }

      // Kilitlenmis bir secim, sonradan gelen "geziniyor" bilgisiyle
      // BOZULMAMALI: aksi halde oyuncu baska hero'nun uzerinde gezindiginde
      // daha once kilitledigi hero ekrandan siliniyor.
      const previous = picks.get(index);
      if (previous?.confirmed && traversal) {
        continue;
      }
      picks.set(index, { heroId, confirmed: !traversal });
      snapshot.at = parseLogTimestamp(line) || snapshot.at;
      continue;
    }

    if (line.includes("[DD] Bans updated:")) {
      const parsed = readJsonAfter(line, "[DD] Bans updated:");
      if (Array.isArray(parsed)) {
        bans = parsed;
        snapshot.at = parseLogTimestamp(line) || snapshot.at;
      }
      continue;
    }

    if (line.includes("matchStore: Roster:")) {
      const parsed = readJsonAfter(line, "matchStore: Roster:");
      if (Array.isArray(parsed) && parsed.length) {
        roster = parsed;
        snapshot.at = parseLogTimestamp(line) || snapshot.at;
      }
      continue;
    }

    const state = LINE_MATCH_STATE.exec(line);
    if (state) {
      matchState = state[1] === "null" ? "" : state[1];
      continue;
    }

    const ended = LINE_MATCH_ENDED.exec(line);
    if (ended && ended[1] === snapshot.matchId) {
      snapshot.ended = true;
      snapshot.winner = ended[2].toLowerCase();
      snapshot.at = parseLogTimestamp(line) || snapshot.at;
    }
  }

  snapshot.matchState = matchState;
  snapshot.picks = [...picks.entries()]
    .map(([index, row]) => ({
      index,
      team: teamFromPlayerIndex(index),
      slot: teamSlotFromPlayerIndex(index),
      heroId: row.heroId,
      hero: heroKey(row.heroId),
      confirmed: row.confirmed,
    }))
    .filter((row) => row.hero)
    .sort((a, b) => a.index - b.index);

  snapshot.bans = bans
    .map((row) => ({
      heroId: Number(row?.heroId) || 0,
      hero: heroKey(row?.heroId),
    }))
    .filter((row) => row.hero);

  // Anonim OLMAYAN maclarda (izleme, bazi lobiler) tam roster gelir.
  snapshot.players = roster
    .map((row) => {
      const index = Number(row?.player_index);
      const accountId = String(row?.steamId || "");
      return {
        index,
        team: teamFromPlayerIndex(index),
        slot: teamSlotFromPlayerIndex(index),
        accountId: accountId === "0" ? "" : accountId,
        name: String(row?.name || ""),
        hero: normalizeHeroKey(String(row?.hero || "")),
        rank: Number(row?.rank) || 0,
        medalName: String(row?.medal_name || ""),
        medalStars: Number(row?.medal_stars) || 0,
        position: Number(row?.position) || 0,
      };
    })
    .filter((row) => Number.isInteger(row.index) && row.team);

  return snapshot;
}

/**
 * `DotaPlusObject_*.log` ayristirmasi.
 *
 * Tek bir satir cok sey verir: her slotun RANK'i (anonim macta bile gelir),
 * kendi tarafimiz, parti uyeleri ve mac kimligi.
 *
 *   Roster {"heroPool":[],"roster":[{"playerIndex":0,"role":5,"steamId":"0",
 *     "name":"","rank":54}, ...],"matchId":"8972022536","gameMode":"AllDraft",
 *     "playerActivity":0,"partySteamIds":[],"isSimulation":false,
 *     "isRanked":true,"amIRadiant":false}
 *
 * `isSimulation:true` satirlari DotaPlus'in kendi "meta pick" denemeleridir,
 * gercek mac degildir; atlanir.
 *
 * @param {string} text
 * @returns {{ matchId: string, gameMode: string, ranked: boolean, activity: string, myTeam: string, players: Array<Record<string, any>>, partySteamIds: string[], at: string }|null}
 */
export function parseDotaPlusObjectLog(text) {
  const ACTIVITY = { 0: "playing", 1: "spectating", 2: "coaching" };
  let latest = null;

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.includes("Roster {")) {
      continue;
    }
    const parsed = readJsonAfter(line, "Roster ");
    if (!parsed || parsed.isSimulation === true) {
      continue;
    }
    const roster = Array.isArray(parsed.roster) ? parsed.roster : [];
    if (!roster.length) {
      continue;
    }

    latest = {
      matchId: String(parsed.matchId || ""),
      gameMode: String(parsed.gameMode || ""),
      ranked: Boolean(parsed.isRanked),
      activity: ACTIVITY[Number(parsed.playerActivity)] || "",
      myTeam:
        parsed.amIRadiant === true
          ? "radiant"
          : parsed.amIRadiant === false
            ? "dire"
            : "",
      partySteamIds: (Array.isArray(parsed.partySteamIds)
        ? parsed.partySteamIds
        : []
      ).map((value) => String(value)),
      players: roster
        .map((row) => {
          const index = Number(row?.playerIndex);
          const accountId = String(row?.steamId || "");
          return {
            index,
            team: teamFromPlayerIndex(index),
            slot: teamSlotFromPlayerIndex(index),
            // Anonim macta "0" gelir; kimlik yok demektir.
            accountId: accountId === "0" ? "" : accountId,
            name: String(row?.name || ""),
            rank: Number(row?.rank) || 0,
            role: Number(row?.role) || 0,
          };
        })
        .filter((row) => Number.isInteger(row.index) && row.team),
      at: parseLogTimestamp(line),
    };
  }

  return latest;
}

/**
 * Iki logun sonucunu tek bir canli mac goruntusune birlestirir.
 *
 * Hero'lar controller logundan, rank'lar object logundan gelir. Ikisi ayni
 * maci anlatmiyorsa (biri eski) yalnizca controller'a guvenilir; yanlis maca
 * ait rank gostermek, hic gostermemekten kotudur.
 *
 * @param {{ controllerText?: string, objectText?: string }} input
 * @returns {ReturnType<typeof emptySnapshot>|null}
 */
export function buildOverwolfSnapshot(input = {}) {
  const controller = parseDotaPlusControllerLog(input.controllerText || "");
  const object = parseDotaPlusObjectLog(input.objectText || "");

  if (!controller.matchId && !object?.matchId) {
    return null;
  }

  const snapshot = controller.matchId
    ? controller
    : { ...emptySnapshot(), matchId: object.matchId };

  const sameMatch = Boolean(object) && object.matchId === snapshot.matchId;
  if (sameMatch) {
    snapshot.partySteamIds = object.partySteamIds;
    snapshot.myTeam = snapshot.myTeam || object.myTeam;
    snapshot.activity = snapshot.activity || object.activity;
    snapshot.gameMode = snapshot.gameMode || object.gameMode;
    snapshot.ranked = snapshot.ranked || object.ranked;
    if (object.at > snapshot.at) {
      snapshot.at = object.at;
    }
  }

  // Slot bazli birlestirme: controller tam roster verdiyse o esas alinir,
  // object logu yalnizca eksik alanlari doldurur.
  const bySlot = new Map();
  for (const row of snapshot.players) {
    bySlot.set(row.index, { ...row });
  }
  if (sameMatch) {
    for (const row of object.players) {
      const existing = bySlot.get(row.index);
      if (existing) {
        existing.rank = existing.rank || row.rank;
        existing.accountId = existing.accountId || row.accountId;
        existing.name = existing.name || row.name;
        existing.role = existing.role || row.role;
      } else {
        bySlot.set(row.index, { ...row, hero: "" });
      }
    }
  }

  // Hero'yu her zaman controller'daki secimden yaz: roster satiri maca gore
  // eski kalabiliyor, pick satirlari ise anlik.
  for (const pick of snapshot.picks) {
    const existing = bySlot.get(pick.index) || {
      index: pick.index,
      team: pick.team,
      slot: pick.slot,
      accountId: "",
      name: "",
      rank: 0,
    };
    existing.hero = pick.hero;
    existing.heroConfirmed = pick.confirmed;
    bySlot.set(pick.index, existing);
  }

  snapshot.players = [...bySlot.values()].sort((a, b) => a.index - b.index);
  return snapshot;
}
