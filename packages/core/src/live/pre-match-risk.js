/**
 * MAC ONCESI RISK ANALIZORU
 *
 * Lobi yuklendigi an 10 oyuncunun son maclarina bakar ve uc soruya cevap verir:
 *
 *   1. Oyuncu ne durumda?  (tilt, hero konforu, rol uyumu)
 *   2. Mac kimin lehine?   (%44 - %56 araliginda kazanma ihtimali)
 *   3. Ne yapmali?         (kisa, aksiyon alinabilir uyarilar)
 *
 * IKI KATMAN
 * ----------
 *   loadLobbyPlayers()   Paralel cekim. Ag istegini YAPMAZ, cagiranin verdigi
 *                        `fetchPlayer`'i oyuncu basina zaman asimiyla calistirir.
 *                        Core paketi ortamdan bagimsiz kalsin diye (bkz. index.js).
 *   buildPreMatchRisk()  Saf ve senkron hesap. Ayni girdiye ayni cikti; test ve
 *                        her GSI tick'inde yeniden calistirmak icin ucuz.
 *
 * AGIRLIKLAR (RISK_WEIGHTS)
 * -------------------------
 *   %40 Performans trendi  : son 5 macin (buzulmus) kazanma orani + rutbe farki
 *   %35 Draft              : hero sinerjisi + counter dengesi
 *   %25 Davranis / profil  : tilt, hero konforu, rol uyumu
 *
 * Her bilesen once takim basina [-1, 1] araligina indirgenir, sonra iki takimin
 * farki alinir. Toplam sinyal tanh ile yumusatilip 50 +/- 6 puana yayilir: tek
 * bir uc deger (5 maclik seri) olasiligi aralik disina itemez, kucuk farklar
 * da 50'ye yapismaz.
 *
 * GIZLI PROFIL
 * ------------
 * Mac gecmisi gelmeyen oyuncu (gizli profil, zaman asimi, anonim slot) icin
 * rutbe = bolge ortalamasi (`regionRankTier`); form ve davranis puanlari ise
 * lobideki BILINEN oyuncularin ortalamasi olur. Sifir (notr) vermek, gizli
 * oyuncusu cok olan takimi sistematik olarak "ortalamanin altinda" gosterirdi.
 */

import { countersOf } from "../draft/draft-advisor.js";
import {
  getDraftMetrics,
  summarizeTeamDraft,
} from "../draft/draft-analyzer.js";
import { heroDisplayName, normalizeHeroKey } from "../heroes/hero-names.js";
import {
  ROLE_GROUP,
  ROLE_SHORT_LABELS,
  normalizeRoleKey,
} from "../players/player-types.js";
import { toAccountId } from "../players/roster.js";

/** @typedef {import("../players/player-types.js").PlayerMatch} PlayerMatch */
/** @typedef {import("../players/player-types.js").RoleKey} RoleKey */

/** Tilt / form icin bakilan son mac sayisi. */
export const TREND_WINDOW = 5;
/** Hero konforu icin bakilan son mac sayisi (tum zamanlar verisi yoksa). */
export const COMFORT_WINDOW = 20;
/** Oyuncu basina cekim zaman asimi; lobi ekrani bekletilmez. */
export const FETCH_TIMEOUT_MS = 2500;
/** Kazanma ihtimalinin siniri. Mac oncesi veriyle bundan emin olunamaz. */
export const WIN_PROBABILITY_RANGE = { min: 44, max: 56 };
export const RISK_WEIGHTS = { performance: 0.4, draft: 0.35, behavior: 0.25 };

/** Son kayip bu kadar yakin bittiyse oyuncu "sicak" tilt'te sayilir. */
const RECENT_LOSS_MS = 90 * 60 * 1000;
const TILT_HIGH = 0.55;
const TILT_MEDIUM = 0.3;
/** Erken baski hero'su: draft profilinde erken oyun ve tempo ust ceyrekte. */
const AGGRESSIVE_EARLY = 7;
const AGGRESSIVE_TEMPO = 7;

export const COMFORT_LABELS = {
  spammer: "Spammer",
  comfortable: "Rahat",
  learning: "Az oynuyor",
  rare: "Nadiren",
  "first-time": "İlk defa",
  unknown: "Bilinmiyor",
};

/** Konfor seviyesinin davranis puanina katkisi ([-1, 1]). */
const COMFORT_SCORES = {
  spammer: 1,
  comfortable: 0.5,
  learning: -0.2,
  rare: -0.4,
  "first-time": -1,
  unknown: 0,
};

/** Rol uyumunun davranis puanina katkisi ([-1, 1]). */
const ROLE_FIT_SCORES = { match: 1, flex: 0.2, mismatch: -1, unknown: 0 };

/**
 * @typedef {Object} LobbySlot
 * @property {string} accountId  32-bit hesap kimligi ("" = anonim / bilinmiyor)
 * @property {"radiant"|"dire"} team
 * @property {string} [hero]      Secilmisse hero key'i
 * @property {number|string} [position] Bu mactaki pozisyon: 1-5 ya da "pos3"
 * @property {string} [name]
 */

/**
 * `fetchPlayer`'in dondurdugu ham veri. Hepsi istege bagli.
 *
 * @typedef {Object} FetchedPlayer
 * @property {PlayerMatch[]} [matches] Son maclar (sira onemli degil)
 * @property {Array<{ hero: string, matches: number, wins?: number }>} [heroes]
 *   Tum zamanlar hero istatistigi (PlayerStats.heroes). Yoksa konfor yalnizca
 *   son maclardan cikar ve "ilk defa" denemez.
 * @property {number|null} [rankTier]
 * @property {string} [primaryRole]
 * @property {boolean} [isPrivate]
 * @property {number} [griefFlags] Son maclarda item satma/kirma, feed, abandon
 *   gibi isaretler (Overwolf logundan cagiran sayar).
 */

/**
 * @typedef {Object} LoadedPlayer
 * @property {LobbySlot} slot
 * @property {FetchedPlayer|null} data
 * @property {"ok"|"private"|"timeout"|"failed"} status
 */

function clamp(value, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("timeout"), { code: "timeout" })),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// --- 1. Veri cekimi ----------------------------------------------------------

/**
 * GSI / Overwolf'tan gelen canli durumu lobi slotlarina cevirir.
 *
 * @param {Record<string, any>} liveState normalizeGsiPayload / merge-live ciktisi
 * @returns {LobbySlot[]}
 */
export function lobbySlotsFromLiveState(liveState) {
  return [
    ...(liveState?.radiantPlayers || []),
    ...(liveState?.direPlayers || []),
  ].map(lobbySlotFromRow);
}

/**
 * Tek canli mac satiri -> lobi slotu.
 *
 * @param {Record<string, any>} row
 * @returns {LobbySlot}
 */
export function lobbySlotFromRow(row) {
  return {
    accountId: String(row?.accountId || "") || toAccountId(row?.steamId || ""),
    team: row?.team === "dire" ? "dire" : "radiant",
    hero: normalizeHeroKey(row?.hero || ""),
    position: row?.position || "",
    name: row?.name || "",
  };
}

/**
 * Lobideki oyunculari PARALEL ceker. Biri yavas ya da hatali diye digerleri
 * beklemez: her istek kendi zaman asimiyla calisir, sonuc slot sirasiyla doner.
 *
 * @param {Object} input
 * @param {LobbySlot[]} input.slots
 * @param {(slot: LobbySlot) => Promise<FetchedPlayer|null>} input.fetchPlayer
 * @param {number} [input.timeoutMs]
 * @returns {Promise<LoadedPlayer[]>}
 */
export async function loadLobbyPlayers({
  slots,
  fetchPlayer,
  timeoutMs = FETCH_TIMEOUT_MS,
}) {
  const settled = await Promise.allSettled(
    slots.map((slot) =>
      slot.accountId
        ? withTimeout(
            Promise.resolve().then(() => fetchPlayer(slot)),
            timeoutMs,
          )
        : Promise.resolve(null),
    ),
  );

  return slots.map((slot, index) => {
    const result = settled[index];
    if (result.status === "rejected") {
      return {
        slot,
        data: null,
        status: result.reason?.code === "timeout" ? "timeout" : "failed",
      };
    }
    const data = result.value || null;
    const hasMatches = Boolean(data?.matches?.length);
    return {
      slot,
      data,
      status: hasMatches && !data?.isPrivate ? "ok" : "private",
    };
  });
}

// --- 2. Oyuncu analizi -------------------------------------------------------

/**
 * @param {PlayerMatch[]} matches
 * @returns {PlayerMatch[]} En yeni once
 */
function newestFirst(matches) {
  return [...(matches || [])].sort(
    (a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0),
  );
}

/**
 * TILT FAKTORU: son 5 macin kayip orani, sondan geriye kayip serisi, son
 * kaybin tazeligi ve davranis isaretleri.
 *
 * @param {PlayerMatch[]} recent En yeni once, en fazla TREND_WINDOW
 * @param {number} griefFlags
 * @param {number} now
 */
export function tiltOf(recent, griefFlags = 0, now = Date.now()) {
  const wins = recent.filter((match) => match.result === "win").length;
  const losses = recent.length - wins;
  let lossStreak = 0;
  while (recent[lossStreak]?.result === "loss") {
    lossStreak += 1;
  }

  let tilt = 0;
  if (recent.length) {
    tilt += clamp((losses / recent.length - 0.4) / 0.6, 0, 1) * 0.45;
    tilt += (Math.min(lossStreak, 4) / 4) * 0.35;
    const last = recent[0];
    const endedAt =
      (Date.parse(last.startedAt) || 0) + (last.durationSeconds || 0) * 1000;
    if (last.result === "loss" && now - endedAt < RECENT_LOSS_MS) {
      tilt += 0.1;
    }
  }
  if (griefFlags > 0) {
    tilt += 0.35;
  }
  tilt = clamp(tilt, 0, 1);

  return {
    matches: recent.length,
    wins,
    losses,
    lossStreak,
    griefFlags,
    tilt: round(tilt),
    level: tilt >= TILT_HIGH ? "high" : tilt >= TILT_MEDIUM ? "medium" : "low",
  };
}

/**
 * HERO KONFORU: tum zamanlar mac sayisi + son 20 macta kac kez alindigi.
 *
 * @param {string} hero
 * @param {PlayerMatch[]} window En yeni once, en fazla COMFORT_WINDOW
 * @param {FetchedPlayer["heroes"]} [lifetime]
 */
export function comfortOf(hero, window, lifetime) {
  const key = normalizeHeroKey(hero);
  if (!key) {
    return { level: "unknown", heroMatches: null, recentMatches: 0, score: 0 };
  }
  const recentMatches = window.filter(
    (match) => normalizeHeroKey(match.hero) === key,
  ).length;
  const row = lifetime?.find((entry) => normalizeHeroKey(entry.hero) === key);
  const heroMatches = lifetime ? Number(row?.matches) || 0 : null;
  const total = heroMatches ?? 0;

  /** @type {keyof typeof COMFORT_SCORES} */
  let level;
  if (total >= 50 || recentMatches >= 6) {
    level = "spammer";
  } else if (total >= 15 || recentMatches >= 3) {
    level = "comfortable";
  } else if (total >= 3 || recentMatches >= 1) {
    level = "learning";
  } else {
    // Tum zamanlar verisi yoksa "hic oynamadi" diyemeyiz, yalnizca "son
    // maclarda yok".
    level = heroMatches === null ? "rare" : "first-time";
  }
  return { level, heroMatches, recentMatches, score: COMFORT_SCORES[level] };
}

/**
 * ROL UYUMU: bu mactaki rol (GSI/Overwolf) ile oyuncunun ana rolu.
 *
 * @param {RoleKey|""} liveRole
 * @param {string} declaredRole Profildeki ana rol
 * @param {PlayerMatch[]} window En yeni once
 */
export function roleFitOf(liveRole, declaredRole, window) {
  const counts = {};
  for (const match of window) {
    const role = normalizeRoleKey(match.role);
    if (role) {
      counts[role] = (counts[role] || 0) + 1;
    }
  }
  const mostPlayed = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const primaryRole =
    normalizeRoleKey(declaredRole) ||
    (mostPlayed && mostPlayed[1] >= 3 ? mostPlayed[0] : "");

  /** @type {keyof typeof ROLE_FIT_SCORES} */
  let level = "unknown";
  if (liveRole && primaryRole) {
    if (liveRole === primaryRole) {
      level = "match";
    } else if (
      ROLE_GROUP[liveRole] === ROLE_GROUP[primaryRole] ||
      (counts[liveRole] || 0) >= 3
    ) {
      // Ayni grup (core/support) ya da ikincil rolu olarak duzenli oynuyor.
      level = "flex";
    } else {
      level = "mismatch";
    }
  }
  return { liveRole, primaryRole, level, score: ROLE_FIT_SCORES[level] };
}

/**
 * Tek oyuncunun risk profili. Gizli profil burada `source: "fallback"` olur;
 * puanlari `buildPreMatchRisk` lobi ortalamasiyla doldurur.
 *
 * @param {LoadedPlayer} loaded
 * @param {{ regionRankTier?: number, now?: number }} [options]
 */
export function analyzePlayer(loaded, options = {}) {
  const { slot, data, status } = loaded;
  const hero = normalizeHeroKey(slot.hero || "");
  const liveRole = normalizeRoleKey(slot.position);
  const base = {
    accountId: slot.accountId,
    team: slot.team,
    name: slot.name || "",
    hero,
    heroName: hero ? heroDisplayName(hero) : "",
    status,
  };

  if (status !== "ok" || !data) {
    return {
      ...base,
      source: /** @type {const} */ ("fallback"),
      rankTier: data?.rankTier || options.regionRankTier || null,
      trend: tiltOf([], data?.griefFlags || 0),
      comfort: comfortOf("", [], undefined),
      roleFit: roleFitOf(liveRole, data?.primaryRole || "", []),
      scores: { performance: 0, behavior: 0 },
    };
  }

  const sorted = newestFirst(data.matches || []);
  const recent = sorted.slice(0, TREND_WINDOW);
  const window = sorted.slice(0, COMFORT_WINDOW);
  const trend = tiltOf(recent, data.griefFlags || 0, options.now ?? Date.now());
  const comfort = comfortOf(hero, window, data.heroes);
  const roleFit = roleFitOf(liveRole, data.primaryRole || "", window);

  // Buzulmus kazanma orani: 5 macta 5-0 bile 0.75'te kalir -> [-1, 1].
  const shrunk = (trend.wins + 2.5) / (trend.matches + 5);
  const performance = clamp((shrunk - 0.5) * 4);
  const calm = 1 - 2 * trend.tilt;
  const behavior = clamp(
    0.35 * comfort.score + 0.35 * roleFit.score + 0.3 * calm,
  );

  return {
    ...base,
    source: /** @type {const} */ ("profile"),
    rankTier: data.rankTier || options.regionRankTier || null,
    trend,
    comfort,
    roleFit,
    scores: { performance: round(performance), behavior: round(behavior) },
  };
}

/** @typedef {ReturnType<typeof analyzePlayer>} PlayerRisk */

// --- 3. Kazanma ihtimali -----------------------------------------------------

/** Rutbe kademesini dogrusal puana cevirir: Legend 4 (54) -> 29. */
function rankPoints(rankTier) {
  const tier = Number(rankTier) || 0;
  return Math.floor(tier / 10) * 5 + (tier % 10);
}

/**
 * Draft dengesi [-1, 1]: sinerji ortalamasi farki + counter dengesi.
 * Bir taraf henuz pick yapmadiysa 0 (bilinmiyor).
 *
 * @param {string[]} myHeroes
 * @param {string[]} enemyHeroes
 * @param {Record<string, Record<string, any>>} [heroOverrides]
 */
export function draftBalance(myHeroes, enemyHeroes, heroOverrides = {}) {
  if (!myHeroes.length || !enemyHeroes.length) {
    return { score: 0, known: false, synergy: 0, counters: 0 };
  }
  const synergyOf = (heroes) => {
    const avg = summarizeTeamDraft(heroes).avg;
    return (avg.teamSynergy + avg.comboPotential + avg.laneSynergy) / 3;
  };
  const synergy = clamp((synergyOf(myHeroes) - synergyOf(enemyHeroes)) / 3);

  const hits = (heroes, against) =>
    heroes.reduce(
      (sum, hero) =>
        sum +
        countersOf(hero, heroOverrides).filter((key) => against.includes(key))
          .length,
      0,
    );
  // Rakibin hero'larinin counter listesinde bizimkiler = biz onlari counter'liyoruz.
  const counters = clamp(
    (hits(enemyHeroes, myHeroes) - hits(myHeroes, enemyHeroes)) / 4,
  );

  return {
    score: round(clamp(0.5 * synergy + 0.5 * counters)),
    known: true,
    synergy: round(synergy),
    counters: round(counters),
  };
}

/**
 * @param {PlayerRisk[]} mine
 * @param {PlayerRisk[]} enemy
 * @param {ReturnType<typeof draftBalance>} draft
 */
function winProbability(mine, enemy, draft) {
  const ranked = [...mine, ...enemy].filter((p) => p.rankTier);
  const lobbyRank = average(ranked.map((p) => rankPoints(p.rankTier)));
  // Rutbesi bilinmeyen oyuncu lobi ortalamasinda sayilir (fark 0); 0 puan
  // vermek onu Herald'dan da asagi gosterirdi.
  const teamPerformance = (players) =>
    average(
      players.map(
        (p) =>
          0.75 * p.scores.performance +
          0.25 *
            (p.rankTier ? clamp((rankPoints(p.rankTier) - lobbyRank) / 10) : 0),
      ),
    );
  const teamBehavior = (players) =>
    average(players.map((p) => p.scores.behavior));

  const parts = {
    performance: (teamPerformance(mine) - teamPerformance(enemy)) / 2,
    draft: draft.score,
    behavior: (teamBehavior(mine) - teamBehavior(enemy)) / 2,
  };
  const signal =
    RISK_WEIGHTS.performance * parts.performance +
    RISK_WEIGHTS.draft * parts.draft +
    RISK_WEIGHTS.behavior * parts.behavior;

  const { min, max } = WIN_PROBABILITY_RANGE;
  const spread = (max - min) / 2;
  const percent = clamp(50 + spread * Math.tanh(2 * signal), min, max);

  return {
    percent: round(percent, 1),
    signal: round(signal, 3),
    breakdown: {
      performance: round(parts.performance),
      draft: round(parts.draft),
      behavior: round(parts.behavior),
    },
  };
}

// --- 4. Uyarilar -------------------------------------------------------------

/**
 * @typedef {Object} RiskAlert
 * @property {"tilt"|"double-down"|"early-pressure"} type
 * @property {"high"|"medium"|"info"} severity
 * @property {string} icon
 * @property {string} title
 * @property {string} message
 * @property {string[]} accountIds
 */

const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 };

function displayName(player) {
  return player.name || player.heroName || "Bir oyuncu";
}

/** @param {PlayerRisk[]} mine @returns {RiskAlert|null} */
function tiltAlert(mine) {
  const risky = mine.filter(
    (p) =>
      p.source === "profile" &&
      (p.trend.level === "high" || p.trend.griefFlags > 0),
  );
  if (!risky.length) {
    return null;
  }
  const details = risky.slice(0, 2).map((p) => {
    const notes = [`son ${p.trend.matches} maçta ${p.trend.losses} kayıp`];
    if (p.trend.lossStreak >= 3) {
      notes.push(`${p.trend.lossStreak} seri`);
    }
    if (p.trend.griefFlags > 0) {
      notes.push("eşya satma/kırma geçmişi");
    }
    return `${displayName(p)} (${notes.join(", ")})`;
  });
  return {
    type: "tilt",
    severity: "high",
    icon: "⚠️",
    title: "Yüksek Tilt Riski",
    message: `${details.join("; ")}. İlk 10 dk bu koridora erken rotasyon yapın, ilk ölümde suçlamayın, chat'i sakin tutun.`,
    accountIds: risky.map((p) => p.accountId),
  };
}

/**
 * @param {PlayerRisk[]} mine
 * @param {ReturnType<typeof draftBalance>} draft
 * @param {ReturnType<typeof winProbability>} probability
 * @param {number} confidence
 * @returns {RiskAlert|null}
 */
function doubleDownAlert(mine, draft, probability, confidence) {
  const form = average(mine.map((p) => p.scores.performance));
  const anyTilt = mine.some(
    (p) => p.trend.level === "high" || p.trend.griefFlags > 0,
  );
  if (
    anyTilt ||
    confidence < 0.6 ||
    !draft.known ||
    draft.score < 0.15 ||
    form < 0.2 ||
    probability.percent < 53
  ) {
    return null;
  }
  return {
    type: "double-down",
    severity: "info",
    icon: "🔥",
    title: "Double Down Fırsatı",
    message: `Form ve draft lehinize (%${probability.percent}). Takımda kayıp serisi yok, sinerji güçlü: Double Down için uygun maç.`,
    accountIds: mine.map((p) => p.accountId).filter(Boolean),
  };
}

/** @param {PlayerRisk[]} enemy @returns {RiskAlert|null} */
function earlyPressureAlert(enemy) {
  const threats = enemy.filter((p) => {
    if (p.comfort.level !== "spammer" || !p.hero) {
      return false;
    }
    const metrics = getDraftMetrics(p.hero);
    return (
      metrics.earlyGame >= AGGRESSIVE_EARLY && metrics.tempo >= AGGRESSIVE_TEMPO
    );
  });
  if (!threats.length) {
    return null;
  }
  const details = threats.slice(0, 2).map((p) => {
    const games = p.comfort.heroMatches ?? p.comfort.recentMatches;
    const role = p.roleFit.liveRole || p.roleFit.primaryRole;
    const where = role ? `, ${ROLE_SHORT_LABELS[role]}` : "";
    return `${p.heroName} spammer'ı (${games} maç${where})`;
  });
  return {
    type: "early-pressure",
    severity: "medium",
    icon: "🛡️",
    title: "Erken Baskı Uyarısı",
    message: `Rakipte ${details.join(" ve ")}. İlk 8 dk koridor girişlerine ve rün noktalarına ward atın, sentry hazır tutun.`,
    accountIds: threats.map((p) => p.accountId).filter(Boolean),
  };
}

// --- Birlestirme -------------------------------------------------------------

/**
 * Saf hesap: yuklenmis oyunculardan risk raporu.
 *
 * @param {Object} input
 * @param {LoadedPlayer[]} input.players
 * @param {"radiant"|"dire"} input.myTeam
 * @param {number} [input.regionRankTier] Gizli profiller icin bolge ortalamasi
 * @param {number} [input.now]
 * @param {Record<string, Record<string, any>>} [input.heroOverrides]
 */
export function buildPreMatchRisk(input) {
  const { myTeam, now, heroOverrides = {} } = input;
  // Bolge ortalamasi verilmezse lobide rutbesi gorunenlerin ortalamasi.
  const knownTiers = input.players
    .map((p) => Number(p.data?.rankTier) || 0)
    .filter(Boolean);
  // Ortalama puan uzerinden alinir: 54 ile 61'in duz ortalamasi (57.5)
  // gecersiz bir kademe olurdu.
  const meanPoints = Math.round(average(knownTiers.map(rankPoints)));
  const regionRankTier =
    input.regionRankTier ||
    (knownTiers.length
      ? Math.floor(meanPoints / 5) * 10 + (meanPoints % 5)
      : undefined);
  const analyzed = input.players.map((loaded) =>
    analyzePlayer(loaded, { regionRankTier, now }),
  );

  // Gizli profiller lobideki bilinen oyuncularin ortalamasini alir.
  const known = analyzed.filter((p) => p.source === "profile");
  const imputed = {
    performance: round(average(known.map((p) => p.scores.performance))),
    behavior: round(average(known.map((p) => p.scores.behavior))),
  };
  const players = analyzed.map((p) =>
    p.source === "fallback" ? { ...p, scores: imputed } : p,
  );

  const mine = players.filter((p) => p.team === myTeam);
  const enemy = players.filter((p) => p.team !== myTeam);
  const draft = draftBalance(
    mine.map((p) => p.hero).filter(Boolean),
    enemy.map((p) => p.hero).filter(Boolean),
    heroOverrides,
  );
  const probability = winProbability(mine, enemy, draft);

  // Guven: profili gorunen oyuncu orani (%80) + draft biliniyor mu (%20).
  const confidence = round(
    0.8 * (players.length ? known.length / players.length : 0) +
      (draft.known ? 0.2 : 0),
  );

  const alerts = [
    tiltAlert(mine),
    earlyPressureAlert(enemy),
    doubleDownAlert(mine, draft, probability, confidence),
  ]
    .filter(Boolean)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    myTeam,
    winProbability: {
      myTeam: probability.percent,
      enemyTeam: round(100 - probability.percent, 1),
      breakdown: probability.breakdown,
      signal: probability.signal,
    },
    draft,
    confidence,
    players,
    alerts,
  };
}

/**
 * Onceden toplanmis lobi verisinden (accountId -> FetchedPlayer; bkz.
 * player-data-service getLobbyInputs) `buildPreMatchRisk` girdisi.
 *
 * @param {LobbySlot[]} slots
 * @param {Record<string, FetchedPlayer>} byAccountId
 * @returns {LoadedPlayer[]}
 */
export function loadedFromInputs(slots, byAccountId = {}) {
  return slots.map((slot) => {
    const data = (slot.accountId && byAccountId[slot.accountId]) || null;
    return {
      slot,
      data,
      status: data?.matches?.length && !data.isPrivate ? "ok" : "private",
    };
  });
}

/**
 * Canli panel ve overlay icin kisa ozet: oyuncu listesi tasinmaz.
 *
 * Gorunurluk: hic profil gorunmuyor ve draft da yoksa sonuc yazi-tura
 * (%50); ekranda sayi gostermek yaniltici olurdu.
 *
 * @param {ReturnType<typeof buildPreMatchRisk>} report
 */
export function summarizePreMatchRisk(report) {
  const mine = report.winProbability.myTeam;
  const enemy = report.winProbability.enemyTeam;
  const radiant = report.myTeam === "radiant" ? mine : enemy;
  return {
    visible: report.confidence >= MIN_VISIBLE_CONFIDENCE,
    myTeam: report.myTeam,
    radiant,
    dire: round(100 - radiant, 1),
    confidence: report.confidence,
    knownPlayers: report.players.filter((p) => p.source === "profile").length,
    breakdown: report.winProbability.breakdown,
    alerts: report.alerts,
  };
}

/** Bu guvenin altinda kazanma ihtimali gosterilmez. */
const MIN_VISIBLE_CONFIDENCE = 0.2;

/**
 * Tek cagri: lobiyi paralel cek, raporu uret.
 *
 * @param {Object} input
 * @param {LobbySlot[]} input.slots Bkz. lobbySlotsFromLiveState
 * @param {"radiant"|"dire"} input.myTeam
 * @param {(slot: LobbySlot) => Promise<FetchedPlayer|null>} input.fetchPlayer
 * @param {number} [input.regionRankTier]
 * @param {number} [input.timeoutMs]
 * @param {Record<string, Record<string, any>>} [input.heroOverrides]
 */
export async function analyzePreMatchRisk(input) {
  const players = await loadLobbyPlayers({
    slots: input.slots,
    fetchPlayer: input.fetchPlayer,
    timeoutMs: input.timeoutMs,
  });
  return buildPreMatchRisk({ ...input, players });
}
