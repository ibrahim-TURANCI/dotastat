/**
 * Draft asistani.
 *
 * Uc asamada calisir:
 *
 *   1. "pre"      - Henuz hic pick yok. Lobide taninan oyuncular varsa
 *                   (roster'daki arkadaslar) onlarin rol/hero havuzuna gore
 *                   pick onerisi verir. Oyuncu taninmiyorsa genel meta onerisi.
 *   2. "active"   - Pickler suruyor. Kendi takimin + rakip takimin secimlerine
 *                   gore skorlanir; counter, sinerji ve rol bosluklari birlikte
 *                   degerlendirilir.
 *   3. "complete" - 10 pick tamamlandi. Asistan GORUNMEZ (visible: false).
 *
 * Bu modul saftir: ag istegi yapmaz, dosya okumaz.
 */

import heroProfiles from "../data/hero-profiles.js";
import heroRoles from "../data/hero-roles.js";
import { heroDisplayName, normalizeHeroKey } from "../heroes/hero-names.js";
import { ROLE_KEYS, ROLE_LABELS } from "../players/player-types.js";
import { getDraftMetrics, scoreDraftPick } from "./draft-analyzer.js";

/** Bir takimin toplam pick sayisi. */
const PICKS_PER_TEAM = 5;
/** Iki takim toplami. */
const TOTAL_PICKS = PICKS_PER_TEAM * 2;
/** Rol basina gosterilecek oneri sayisi. */
const DEFAULT_SUGGESTIONS_PER_ROLE = 4;

/** hero-roles.json rol adlari -> pos anahtari. */
const ROLE_NAME_TO_SLOTS = {
  carry: ["pos1"],
  mid: ["pos2"],
  offlane: ["pos3"],
  support: ["pos4", "pos5"],
  sup4: ["pos4"],
  sup5: ["pos5"],
};

/** hero-roles.json lane adlari -> pos anahtari. */
const LANE_TO_SLOT = {
  safe: "pos1",
  mid: "pos2",
  offlane: "pos3",
  soft: "pos4",
  hard: "pos5",
  carry: "pos1",
  sup4: "pos4",
  sup5: "pos5",
};

/** Tum bilinen hero anahtarlari (iki veri kaynaginin birlesimi). */
const ALL_HERO_KEYS = Array.from(
  new Set([...Object.keys(heroProfiles), ...Object.keys(heroRoles)]),
).filter(Boolean);

/**
 * Bir hero'nun oynanabilecegi pozisyonlar.
 * @param {string} heroKey
 * @returns {Set<string>}
 */
function heroSlots(heroKey) {
  const key = normalizeHeroKey(heroKey);
  const slots = new Set();

  const roleRow = heroRoles[key];
  if (roleRow) {
    for (const role of roleRow.roles || []) {
      for (const slot of ROLE_NAME_TO_SLOTS[role] || []) {
        slots.add(slot);
      }
    }
    const laneSlot = LANE_TO_SLOT[String(roleRow.lane || "")];
    if (laneSlot) {
      slots.add(laneSlot);
    }
  }

  const profileRow = heroProfiles[key];
  if (profileRow) {
    for (const role of profileRow.roles || []) {
      for (const slot of ROLE_NAME_TO_SLOTS[role] || []) {
        slots.add(slot);
      }
    }
    for (const lane of profileRow.lane || []) {
      const laneSlot = LANE_TO_SLOT[String(lane)];
      if (laneSlot) {
        slots.add(laneSlot);
      }
    }
  }

  return slots;
}

/**
 * Bu hero'yu counter'layan hero listesi.
 * Iki veri kaynagindaki `counters` alani da "bu hero'ya karsi guclu olanlar"
 * anlamindadir.
 * @param {string} heroKey
 * @returns {string[]}
 */
function countersOf(heroKey) {
  const key = normalizeHeroKey(heroKey);
  const fromRoles = heroRoles[key]?.counters || [];
  const fromProfiles = heroProfiles[key]?.counters || [];
  return Array.from(
    new Set(
      [...fromRoles, ...fromProfiles].map((row) => normalizeHeroKey(row)),
    ),
  ).filter(Boolean);
}

/**
 * Draft'in hangi asamada oldugunu belirler.
 *
 * @param {{ picks?: Array<{ hero: string }>, phase?: string }} input
 * @returns {"pre"|"active"|"complete"}
 */
export function resolveDraftStage(input = {}) {
  const picks = Array.isArray(input.picks) ? input.picks : [];
  const phase = String(input.phase || "").toUpperCase();
  const pickCount = picks.filter((row) => row?.hero).length;

  // Oyun basladiysa draft bitmistir; asistanin isi kalmaz.
  if (phase.includes("GAME_IN_PROGRESS") || phase.includes("POST_GAME")) {
    return "complete";
  }
  if (pickCount >= TOTAL_PICKS) {
    return "complete";
  }
  if (pickCount === 0) {
    return "pre";
  }
  return "active";
}

/**
 * Oyuncunun hero havuzundan gelen ilgi puani.
 *
 * @param {import("../players/player-types.js").Player|null} player
 * @param {{ heroes?: Array<{ hero: string, matches: number, winRate: number }> }|null} stats
 * @param {string} heroKey
 * @returns {{ score: number, reasons: string[] }}
 */
function playerAffinity(player, stats, heroKey) {
  if (!player) {
    return { score: 0, reasons: [] };
  }

  const key = normalizeHeroKey(heroKey);
  const profile = player.dotaProfile || {};
  const reasons = [];
  let score = 0;

  if ((profile.signatureHeroes || []).map(normalizeHeroKey).includes(key)) {
    score += 34;
    reasons.push(player.name + " imza kahramanı");
  } else if (
    (profile.preferredHeroes || []).map(normalizeHeroKey).includes(key)
  ) {
    score += 20;
    reasons.push(player.name + " tercih ettiği havuzda");
  } else if (
    (profile.experimentalHeroes || []).map(normalizeHeroKey).includes(key)
  ) {
    score += 6;
    reasons.push(player.name + " deniyor");
  }

  if ((profile.weakHeroes || []).map(normalizeHeroKey).includes(key)) {
    score -= 30;
    reasons.push(player.name + " bu kahramanda zayıf");
  }

  const played = (stats?.heroes || []).find(
    (row) => normalizeHeroKey(row.hero) === key,
  );
  if (played && played.matches >= 2) {
    const winBonus = Math.round((Number(played.winRate || 0) - 0.5) * 40);
    score += Math.min(18, played.matches * 2) + winBonus;
    reasons.push(
      "Son maçlarda " +
        played.matches +
        " kez oynandı (%" +
        Math.round(Number(played.winRate || 0) * 100) +
        " win)",
    );
  }

  return { score, reasons };
}

/**
 * Tek bir hero adayini puanlar.
 *
 * @param {Object} input
 * @param {string} input.hero
 * @param {string[]} input.teamHeroes
 * @param {string[]} input.enemyHeroes
 * @param {import("../players/player-types.js").Player|null} [input.player]
 * @param {Object|null} [input.stats]
 */
function scoreCandidate(input) {
  const hero = normalizeHeroKey(input.hero);
  const teamHeroes = input.teamHeroes || [];
  const enemyHeroes = input.enemyHeroes || [];

  const base = scoreDraftPick({
    candidateHero: hero,
    teamHeroes,
    enemyHeroes,
  });

  let score = base.score;
  const reasons = [...base.reasons];

  // Rakip pickleri: aday, rakibin counter listesinde mi?
  for (const enemy of enemyHeroes) {
    if (countersOf(enemy).includes(hero)) {
      score += 16;
      reasons.push(heroDisplayName(enemy) + " için iyi cevap");
    }
  }

  // Ters yon: adayi counter'layan bir rakip zaten secilmis mi?
  const ownCounters = countersOf(hero);
  for (const enemy of enemyHeroes) {
    if (ownCounters.includes(enemy)) {
      score -= 14;
      reasons.push(heroDisplayName(enemy) + " bu seçime karşı güçlü");
    }
  }

  // Kendi takimindaki combo eslesmeleri.
  const metrics = getDraftMetrics(hero);
  const comboHits = (metrics.comboWithHeroes || [])
    .map(normalizeHeroKey)
    .filter((partner) => teamHeroes.includes(partner));
  if (comboHits.length) {
    score += comboHits.length * 12;
    reasons.push("Combo: " + comboHits.map(heroDisplayName).join(", "));
  }

  const affinity = playerAffinity(
    input.player || null,
    input.stats || null,
    hero,
  );
  score += affinity.score;
  reasons.push(...affinity.reasons);

  return {
    hero,
    heroName: heroDisplayName(hero),
    score: Math.round(score),
    reasons: Array.from(new Set(reasons)).slice(0, 4),
    metrics: {
      teamfight: metrics.teamfight,
      tempo: metrics.tempo,
      scaling: metrics.scaling,
      pushPotential: metrics.pushPotential,
      saveMechanics: metrics.saveMechanics,
    },
  };
}

/**
 * Takimda hangi pozisyonlarin bos oldugunu tahmin eder.
 *
 * @param {string[]} teamHeroes
 * @returns {string[]}
 */
function missingSlots(teamHeroes) {
  const taken = new Set();
  for (const hero of teamHeroes) {
    const slots = Array.from(heroSlots(hero));
    // Tek pozisyona sabitlenmis hero o pozisyonu kesin doldurur.
    if (slots.length === 1 && !taken.has(slots[0])) {
      taken.add(slots[0]);
    }
  }
  // Kalan hero'lari acgozlu sekilde bos slotlara yerlestir.
  for (const hero of teamHeroes) {
    const slots = Array.from(heroSlots(hero));
    if (slots.length <= 1) {
      continue;
    }
    const free = slots.find((slot) => !taken.has(slot));
    if (free) {
      taken.add(free);
    }
  }
  return ROLE_KEYS.filter((slot) => !taken.has(slot));
}

/**
 * Draft onerisini uretir.
 *
 * @param {Object} input
 * @param {"radiant"|"dire"} [input.myTeam] Onerinin kimin icin uretilecegi
 * @param {Array<{ hero: string, team: string }>} [input.picks]
 * @param {Array<{ hero: string, team: string }>} [input.bans]
 * @param {string} [input.phase] GSI `map.game_state`
 * @param {Array<{ player: import("../players/player-types.js").Player, team?: string, role?: string, stats?: Object }>} [input.knownPlayers]
 * @param {number} [input.suggestionsPerRole]
 */
export function buildDraftAdvice(input = {}) {
  const myTeam = input.myTeam === "dire" ? "dire" : "radiant";
  const picks = (Array.isArray(input.picks) ? input.picks : []).filter(
    (row) => row?.hero,
  );
  const bans = (Array.isArray(input.bans) ? input.bans : []).filter(
    (row) => row?.hero,
  );
  const stage = resolveDraftStage({ picks, phase: input.phase });
  const suggestionsPerRole =
    Number(input.suggestionsPerRole) || DEFAULT_SUGGESTIONS_PER_ROLE;

  if (stage === "complete") {
    return {
      stage,
      visible: false,
      reason: "picks-complete",
      myTeam,
      blocks: [],
    };
  }

  const teamHeroes = picks
    .filter((row) => row.team === myTeam)
    .map((row) => normalizeHeroKey(row.hero))
    .filter(Boolean);
  const enemyHeroes = picks
    .filter((row) => row.team !== myTeam)
    .map((row) => normalizeHeroKey(row.hero))
    .filter(Boolean);
  const unavailable = new Set([
    ...teamHeroes,
    ...enemyHeroes,
    ...bans.map((row) => normalizeHeroKey(row.hero)),
  ]);

  // Taninan oyuncular kendi takimimizda olanlarla sinirlanir.
  const knownPlayers = (
    Array.isArray(input.knownPlayers) ? input.knownPlayers : []
  ).filter((row) => row?.player && (!row.team || row.team === myTeam));

  const openSlots = missingSlots(teamHeroes);
  const slotsToFill = openSlots.length ? openSlots : ROLE_KEYS;

  // Her bos pozisyona, o pozisyonu oynayan taninan bir oyuncuyu esle.
  const assigned = new Map();
  const usedPlayers = new Set();
  for (const slot of slotsToFill) {
    const match = knownPlayers.find(
      (row) =>
        !usedPlayers.has(row.player.id) &&
        (row.role === slot || row.player.dotaProfile?.primaryRole === slot),
    );
    if (match) {
      assigned.set(slot, match);
      usedPlayers.add(match.player.id);
    }
  }
  for (const slot of slotsToFill) {
    if (assigned.has(slot)) {
      continue;
    }
    const match = knownPlayers.find(
      (row) =>
        !usedPlayers.has(row.player.id) &&
        (row.player.dotaProfile?.secondaryRoles || []).includes(slot),
    );
    if (match) {
      assigned.set(slot, match);
      usedPlayers.add(match.player.id);
    }
  }

  const blocks = slotsToFill.map((slot) => {
    const owner = assigned.get(slot) || null;
    const candidates = ALL_HERO_KEYS.filter(
      (hero) => !unavailable.has(hero) && heroSlots(hero).has(slot),
    );

    const suggestions = candidates
      .map((hero) =>
        scoreCandidate({
          hero,
          teamHeroes,
          enemyHeroes,
          player: owner?.player || null,
          stats: owner?.stats || null,
        }),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, suggestionsPerRole);

    return {
      role: slot,
      roleLabel: ROLE_LABELS[slot] || slot,
      player: owner ? { id: owner.player.id, name: owner.player.name } : null,
      suggestions,
    };
  });

  const notes = [];
  if (stage === "pre") {
    notes.push(
      knownPlayers.length
        ? "Pick başlamadı. Öneriler lobideki tanınan oyuncuların hero havuzuna göre sıralandı."
        : "Pick başlamadı. Lobide tanınan oyuncu yok; öneriler genel rol dengesine göre sıralandı.",
    );
  } else {
    notes.push(
      "Öneriler kendi " +
        teamHeroes.length +
        " pickinize ve rakibin " +
        enemyHeroes.length +
        " pickine göre güncellendi.",
    );
  }
  if (bans.length) {
    notes.push(bans.length + " banlı kahraman öneri havuzundan çıkarıldı.");
  }

  return {
    stage,
    visible: true,
    myTeam,
    teamHeroes,
    enemyHeroes,
    bannedHeroes: Array.from(
      new Set(bans.map((row) => normalizeHeroKey(row.hero))),
    ),
    openSlots,
    knownPlayerCount: knownPlayers.length,
    notes,
    blocks,
  };
}

export { heroSlots, countersOf, ALL_HERO_KEYS };
