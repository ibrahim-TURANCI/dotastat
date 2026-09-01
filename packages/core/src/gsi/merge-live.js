/**
 * Canli mac verisinin BIRDEN FAZLA KAYNAKTAN birlestirilmesi.
 *
 * PROBLEM
 * -------
 * Bir macta ayni kadrodan birkac kisi olabilir ve herkesin kurulumu farkli:
 *
 *   - DotaStat + Overwolf/DotaPlus olan kisi : 10 slotun da hero'sunu ve
 *     rank'ini gorur, ama kimlikler ranked'da gizlidir.
 *   - Yalnizca DotaStat (GSI) olan kisi      : YALNIZCA kendi blogunu gorur —
 *     kimligi, KDA'si, esyalari, net worth'u tam; digerleri hakkinda hicbir sey.
 *   - Tarayicidan bakan kisi                 : hicbir sey gondermez, yalnizca
 *     digerlerinin gonderdigini gorur.
 *
 * Tek bir kaydi secip digerlerini atmak bilgi kaybettiriyor: GSI'ci arkadasin
 * KDA'si ya da Overwolf'cunun gordugu rakip pickleri ekrandan dusuyordu.
 * Bu modul ayni MAC KIMLIGINE ait tum kayitlari tek bir tabloda toplar.
 *
 * BIRLESTIRME ANAHTARI
 * --------------------
 * Kaynaklar ortak bir kimlik paylasmiyor: Overwolf slot numarasi verir ama
 * ranked'da steamId vermez; GSI steamId verir ama slot numarasi vermez.
 * Ortak nokta HERO'dur — bir macta ayni hero iki kez secilemez, bu yuzden
 * hero anahtari iki tarafi guvenle eslestirir.
 *
 * KURAL: Overwolf iskeleti kurar (10 slot, takim, hero, rank), GSI o iskeletin
 * uzerine kendi oyuncusunun detayini yazar. Catisma olursa GSI kazanir — o,
 * oyunun kendi cikisidir.
 */

import { resolveRankTier } from "../players/player-types.js";
import { normalizeHeroKey } from "../heroes/hero-names.js";

/**
 * Bir oyuncu satirinin bos olup olmadigini soyler.
 * `0` ve `""` "veri yok" demektir; birlestirmede uzerine yazilabilir.
 * @param {unknown} value
 */
function isBlank(value) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (typeof value === "number" && !Number.isFinite(value))
  );
}

/**
 * Eslestirme anahtarlari — oncelik sirasiyla.
 * @param {Record<string, any>} row
 * @returns {string[]}
 */
function identityKeys(row) {
  const keys = [];
  const steamId = String(row?.steamId || "").trim();
  const accountId = String(row?.accountId || "").trim();
  const hero = normalizeHeroKey(row?.hero || "");
  if (steamId && steamId !== "0") {
    keys.push("steam:" + steamId);
  }
  if (accountId && accountId !== "0") {
    keys.push("account:" + accountId);
  }
  if (hero) {
    keys.push("hero:" + hero);
  }
  if (row?.team && row?.slot) {
    keys.push("slot:" + row.team + ":" + row.slot);
  }
  return keys;
}

/** GSI'dan gelen, Overwolf'un veremedigi olcum alanlari. */
const STAT_FIELDS = [
  "level",
  "kills",
  "deaths",
  "assists",
  "lastHits",
  "denies",
  "netWorth",
  "gpm",
  "xpm",
];

/**
 * Masadaki YERI belirleyen alanlar.
 *
 * Bunlarda "GSI kazanir" kurali GECERLI DEGILDIR. Sebep olculdu: oyuncu canli
 * oynarken GSI `allplayers` gondermez, yalnizca duz `player` blogu gelir ve o
 * blokta slot numarasi YOKTUR — normalize katmani mecburen 1 uydurur. Bu uydurma
 * deger Overwolf'un oyundan okudugu gercek slotu eziyor, iki oyuncu ayni slota
 * dusuyordu. Bu yuzden yer bilgisi yalnizca BOSSA doldurulur.
 */
const LAYOUT_FIELDS = ["team", "slot", "playerIndex"];

/**
 * Iki oyuncu satirini birlestirir. `incomingWins` catismalarda ustundur.
 *
 * @param {Record<string, any>} base
 * @param {Record<string, any>} incoming
 * @param {{ incomingWins?: boolean }} [options]
 */
function mergePlayerRow(base, incoming, options = {}) {
  const incomingWins = Boolean(options.incomingWins);
  const merged = { ...base };

  for (const [key, value] of Object.entries(incoming || {})) {
    if (isBlank(value)) {
      continue;
    }
    if (LAYOUT_FIELDS.includes(key)) {
      if (isBlank(merged[key])) {
        merged[key] = value;
      }
      continue;
    }
    // Sayisal olcumlerde 0 "veri yok" olabilir; sifirin uzerine yazilmasina
    // izin verilir ama dolu bir degerin uzerine sifir yazilmaz.
    if (STAT_FIELDS.includes(key)) {
      if (Number(value) > 0 || isBlank(merged[key])) {
        merged[key] = value;
      }
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length || !Array.isArray(merged[key]) || !merged[key].length) {
        if (value.length || incomingWins) {
          merged[key] = value;
        }
      }
      continue;
    }
    if (incomingWins || isBlank(merged[key]) || merged[key] === 0) {
      merged[key] = value;
    }
  }

  // Kaynak etiketi: iki taraftan da veri geldiyse ikisi de yazilir.
  const sources = new Set([
    ...(Array.isArray(base?.sources) ? base.sources : [base?.source]),
    ...(Array.isArray(incoming?.sources)
      ? incoming.sources
      : [incoming?.source]),
  ]);
  sources.delete(undefined);
  sources.delete("");
  merged.sources = [...sources];
  merged.source = merged.sources.includes("gsi")
    ? "gsi"
    : merged.sources[0] || "";
  merged.anonymous = !String(merged.steamId || merged.accountId || "").trim();

  return merged;
}

/**
 * Oyuncu listelerini tek tabloda toplar.
 *
 * @param {Array<Array<Record<string, any>>>} lists Oncelik sirasina gore
 *   (once gelen liste catismada kazanir)
 * @returns {Array<Record<string, any>>}
 */
export function mergePlayerLists(lists) {
  /** @type {Array<Record<string, any>>} */
  const rows = [];
  /** @type {Map<string, number>} */
  const index = new Map();

  const place = (row, incomingWins) => {
    const keys = identityKeys(row);
    let found = -1;
    for (const key of keys) {
      if (index.has(key)) {
        found = index.get(key);
        break;
      }
    }

    if (found < 0) {
      rows.push({ ...row });
      found = rows.length - 1;
    } else {
      rows[found] = mergePlayerRow(rows[found], row, { incomingWins });
    }

    // Yeni ogrenilen her kimlik anahtari da haritaya yazilir; boylece
    // "once hero ile eslesti, sonra steamId geldi" durumu calisir.
    for (const key of identityKeys(rows[found])) {
      index.set(key, found);
    }
  };

  const ordered = (Array.isArray(lists) ? lists : []).filter(Array.isArray);
  ordered.forEach((list, listIndex) => {
    for (const row of list) {
      if (row) {
        // Ilk liste iskeleti kurar, sonrakiler catismada kazanir.
        place(row, listIndex > 0);
      }
    }
  });

  return rows;
}

/**
 * Overwolf goruntusunu oyuncu satirlarina cevirir.
 * @param {Record<string, any>} snapshot
 * @returns {Array<Record<string, any>>}
 */
function overwolfPlayerRows(snapshot) {
  return (snapshot?.players || [])
    .filter((row) => row && row.team && (row.hero || row.rank))
    .map((row) => ({
      steamId: "",
      accountId: row.accountId || "",
      name: row.name || "",
      team: row.team,
      slot: row.slot,
      playerIndex: row.index,
      hero: normalizeHeroKey(row.hero || ""),
      heroConfirmed: row.heroConfirmed !== false,
      rank: resolveRankTier(row.rank) || null,
      rankTier: Number(row.rank) || 0,
      source: "overwolf",
      sources: ["overwolf"],
      anonymous: !row.accountId,
    }));
}

/**
 * Overwolf goruntusunun bu canli maca ait olup olmadigini dogrular.
 *
 * Yanlis maca ait pick gostermek, hic gostermemekten kotudur; bu yuzden
 * supheli her durumda `false` doner.
 *
 * @param {Record<string, any>|null} liveState
 * @param {Record<string, any>|null} snapshot
 */
export function isSnapshotForLiveState(liveState, snapshot) {
  if (!snapshot?.matchId) {
    return false;
  }
  const liveMatchId = String(liveState?.matchId || "").trim();
  if (liveMatchId && liveMatchId !== String(snapshot.matchId)) {
    return false;
  }

  // Mac kimligi henuz yoksa (draft basi) hero uzerinden tutarlilik aranir:
  // GSI'nin bildirdigi hero'lar Overwolf tablosunda BASKA takimda cikiyorsa
  // iki kaynak ayni maci anlatmiyordur.
  const bySide = new Map();
  for (const row of snapshot.players || []) {
    if (row?.hero) {
      bySide.set(normalizeHeroKey(row.hero), row.team);
    }
  }
  const gsiPlayers = [
    ...(liveState?.radiantPlayers || []),
    ...(liveState?.direPlayers || []),
  ];
  for (const row of gsiPlayers) {
    const hero = normalizeHeroKey(row?.hero || "");
    if (!hero) {
      continue;
    }
    const side = bySide.get(hero);
    if (side && side !== row.team) {
      return false;
    }
  }

  return true;
}

/**
 * GSI durumunu Overwolf goruntusuyle zenginlestirir.
 *
 * Overwolf yoksa, log okunamiyorsa ya da goruntu baska bir maca aitse durum
 * OLDUGU GIBI doner — uygulama Overwolf'suz da tam calisir.
 *
 * @param {Record<string, any>|null} liveState `normalizeGsiPayload` ciktisi
 * @param {Record<string, any>|null} snapshot `buildOverwolfSnapshot` ciktisi
 * @returns {Record<string, any>|null}
 */
export function applyOverwolfSnapshot(liveState, snapshot) {
  if (!liveState) {
    return liveState;
  }
  if (!isSnapshotForLiveState(liveState, snapshot)) {
    return liveState;
  }

  const gsiPlayers = [
    ...(liveState.radiantPlayers || []),
    ...(liveState.direPlayers || []),
  ].map((row) => ({ ...row, source: "gsi", sources: ["gsi"] }));

  // Once Overwolf iskeleti (10 slot), sonra GSI detayi — GSI catismada kazanir.
  const players = mergePlayerLists([overwolfPlayerRows(snapshot), gsiPlayers]);

  const picks = (snapshot.picks || [])
    .filter((row) => row.hero)
    .map((row) => ({ hero: row.hero, team: row.team, slot: row.slot }));
  const bans = (snapshot.bans || [])
    .filter((row) => row.hero)
    .map((row) => ({ hero: row.hero, team: "" }));

  const existingPicks = liveState.draft?.picks || [];
  const existingBans = liveState.draft?.bans || [];

  return {
    ...liveState,
    matchId: liveState.matchId || String(snapshot.matchId || ""),
    radiantPlayers: players.filter((row) => row.team === "radiant"),
    direPlayers: players.filter((row) => row.team === "dire"),
    draft: {
      ...(liveState.draft || {}),
      // Overwolf 10 slotu birden gorur; GSI canli macta yalnizca kendini.
      // Hangisi daha coksa o kullanilir, boylece izleme modunda GSI'nin
      // zaten tam olan listesi bozulmaz.
      picks: picks.length > existingPicks.length ? picks : existingPicks,
      bans: bans.length > existingBans.length ? bans : existingBans,
    },
    overwolf: {
      matchId: String(snapshot.matchId || ""),
      activity: snapshot.activity || "",
      gameMode: snapshot.gameMode || "",
      ranked: Boolean(snapshot.ranked),
      myTeam: snapshot.myTeam || "",
      mySlot: snapshot.mySlot,
      ended: Boolean(snapshot.ended),
      winner: snapshot.winner || "",
      partySteamIds: snapshot.partySteamIds || [],
      at: snapshot.at || "",
    },
  };
}

/**
 * Ayni maca ait BIRDEN FAZLA yayinci kaydini tek kayda indirger.
 *
 * Ornek: uc arkadas ayni macta. Biri Overwolf'lu (10 hero + rank), ikisi
 * yalnizca GSI'li (kendi KDA'lari). Sonuc: 10 slotun hero'su dolu, o iki
 * arkadasin satirinda ayrica KDA / net worth / esyalar var.
 *
 * @param {Array<Record<string, any>>} states
 * @returns {Record<string, any>|null}
 */
export function mergeLiveStateGroup(states) {
  const rows = (Array.isArray(states) ? states : []).filter(Boolean);
  if (!rows.length) {
    return null;
  }
  if (rows.length === 1) {
    return rows[0];
  }

  const freshness = (row) => new Date(row?.updatedAt || 0).getTime() || 0;
  const byFreshest = [...rows].sort((a, b) => freshness(b) - freshness(a));
  const newest = byFreshest[0];

  // Oyuncu tablosu: once Overwolf iskeleti olan kayitlar (10 slot), sonra
  // digerleri. Boylece bos slotlar dolar, detay ustune yazilir.
  const withOverwolf = byFreshest.filter((row) => row.overwolf);
  const withoutOverwolf = byFreshest.filter((row) => !row.overwolf);
  const lists = [...withOverwolf, ...withoutOverwolf].map((row) => [
    ...(row.radiantPlayers || []),
    ...(row.direPlayers || []),
  ]);
  const players = mergePlayerLists(lists);

  // Draft: en zengin liste kazanir (Overwolf'lu kayit 10 pick gorur).
  const richestPicks = byFreshest
    .map((row) => row.draft?.picks || [])
    .sort((a, b) => b.length - a.length)[0];
  const richestBans = byFreshest
    .map((row) => row.draft?.bans || [])
    .sort((a, b) => b.length - a.length)[0];

  return {
    ...newest,
    radiantPlayers: players.filter((row) => row.team === "radiant"),
    direPlayers: players.filter((row) => row.team === "dire"),
    draft: {
      ...(newest.draft || {}),
      stage: newest.draft?.stage || "",
      picks: richestPicks || [],
      bans: richestBans || [],
    },
    overwolf: withOverwolf[0]?.overwolf || null,
    // Panelde "kimlerden geliyor" gosterilebilsin diye tutulur.
    uploaders: byFreshest
      .map((row) => String(row.uploaderSteamId || ""))
      .filter(Boolean),
  };
}

/**
 * Taze canli mac kayitlarini MAC KIMLIGINE gore gruplayip her grubu
 * birlestirir. Kimligi olmayan kayitlar kendi baslarina kalir.
 *
 * @param {Array<Record<string, any>>} states
 * @returns {Array<Record<string, any>>}
 */
export function mergeLiveStatesByMatch(states) {
  const rows = (Array.isArray(states) ? states : []).filter(Boolean);
  /** @type {Map<string, Array<Record<string, any>>>} */
  const groups = new Map();
  const loners = [];

  for (const row of rows) {
    const matchId = String(row.matchId || "").trim();
    if (!matchId) {
      loners.push(row);
      continue;
    }
    if (!groups.has(matchId)) {
      groups.set(matchId, []);
    }
    groups.get(matchId).push(row);
  }

  const merged = [...groups.values()].map((group) =>
    mergeLiveStateGroup(group),
  );
  return [...merged, ...loners].filter(Boolean);
}
