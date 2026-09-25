/**
 * Draft asistani.
 *
 * Uc asamada calisir:
 *
 *   1. "pre"      - Henuz hic pick yok. Lobide taninan oyuncular varsa
 *                   (roster'daki arkadaslar) onlarin rol/hero havuzuna gore
 *                   pick onerisi verir. Oyuncu taninmiyorsa genel meta onerisi.
 *   2. "active"   - Pickler suruyor. Kendi takimin + rakip takimin secimlerine
 *                   gore skorlanir; counter, sinerji ve rakibin ozellikleri
 *                   birlikte degerlendirilir.
 *   3. "complete" - 10 pick tamamlandi. Asistan GORUNMEZ (visible: false).
 *
 * PICK BITENE KADAR BES POZISYONUN HEPSI GOSTERILIR. Secilen bir hero'nun
 * hangi pozisyon icin alindigini bilmiyoruz: Pudge pos3 icin de pos5 icin de
 * secilebilir. Eskiden "dolu" tahmin edilen pozisyonun onerisi gizleniyordu;
 * tahmin yanlis ciktiginda (Pudge pos3 alinmis, pos5 dolu sanilmis) asil bos
 * pozisyonun onerisi ekrandan kayboluyordu.
 *
 * Bu modul saftir: ag istegi yapmaz, dosya okumaz.
 */

import { heroKeys, heroPositions, heroRecord } from "../heroes/hero-catalog.js";
import { heroDisplayName, normalizeHeroKey } from "../heroes/hero-names.js";
import { detectThreats } from "../live/threats.js";
import { shrunkWinRate } from "../players/hero-pool.js";
import { ROLE_KEYS, ROLE_LABELS } from "../players/player-types.js";
import { scoreDraftPick } from "./draft-analyzer.js";

/** Bir takimin toplam pick sayisi. */
const PICKS_PER_TEAM = 5;
/** Iki takim toplami. */
const TOTAL_PICKS = PICKS_PER_TEAM * 2;
/** Rol basina gosterilecek oneri sayisi. */
const DEFAULT_SUGGESTIONS_PER_ROLE = 4;

/**
 * Rakibin tasidigi bir ozellige CEVAP veren hero'nun puan bonusu.
 *
 * Sabit degil, rakipte o ozelligi tasiyan hero sayisiyla buyur: tek bir
 * Bounty Hunter'a karsi Oracle secmek zorunlu degil, ama Viper + Silencer +
 * Venomancer'a karsi dispel neredeyse sart. Tavan, bonusun oyuncunun hero
 * havuzunu (imza kahramani +34) tamamen ezmemesi icin.
 */
const ANSWER_BONUS_BASE = 10;
const ANSWER_BONUS_PER_HERO = 6;
const ANSWER_BONUS_MAX = 28;

/**
 * Bir hero'nun oynanabilecegi pozisyonlar.
 *
 * KATALOGDAN okunur (uretilmis tohum + kullanicinin "Tavsiyeleri yonet"
 * duzenlemesi): canli mac tavsiyesi de ayni lane rollerini kullaniyor ve
 * kullanici bir hero'ya rol eklediginde draft da bunu gormeli.
 *
 * @param {string} heroKey
 * @param {Record<string, Record<string, any>>} [overrides] hero -> duzenleme
 * @returns {Set<string>}
 */
function heroSlots(heroKey, overrides = {}) {
  const key = normalizeHeroKey(heroKey);
  return heroPositions(heroRecord(key, overrides?.[key] || null));
}

/**
 * Bu hero'yu counter'layan hero listesi ("bu hero'ya karsi guclu olanlar").
 *
 * Katalogdaki `counterHeroes` alanindan okunur; kullanicinin duzenlemesi
 * tohumun uzerine biner.
 *
 * @param {string} heroKey
 * @param {Record<string, Record<string, any>>} [overrides] hero -> duzenleme
 * @returns {string[]}
 */
function countersOf(heroKey, overrides = {}) {
  const key = normalizeHeroKey(heroKey);
  return [...(heroRecord(key, overrides?.[key] || null)?.counterHeroes || [])];
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
 * @param {{ heroes?: Array<{ hero: string, matches: number, wins?: number, winRate: number }> }|null} stats
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
    // Kazanma orani 0.5'e dogru YUMUSATILIR (bkz. hero-pool.js): ham oran
    // 2 macta %100 ile +20 puan veriyordu ve kucuk ornegin gurultusu oneriyi
    // yonetiyordu.
    const wins = Number.isFinite(Number(played.wins))
      ? Number(played.wins)
      : Math.round(Number(played.winRate || 0) * played.matches);
    const winBonus = Math.round(
      (shrunkWinRate(wins, played.matches) - 0.5) * 40,
    );
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
 * Combo puani `scoreDraftPick` icinde hesaplanir ve burada TEKRAR
 * eklenmez: eskiden iki kez sayiliyordu ve combo ortagi basina +30 puan
 * counter ile hero havuzunun onune geciyordu.
 *
 * @param {Object} input
 * @param {string} input.hero
 * @param {string[]} input.teamHeroes
 * @param {string[]} input.enemyHeroes
 * @param {import("../players/player-types.js").Player|null} [input.player]
 * @param {Object|null} [input.stats]
 * @param {ReturnType<typeof detectThreats>} [input.enemyThreats] Rakibin
 *   tasidigi, hero cevabi olan ozellikler
 * @param {Record<string, Record<string, any>>} [input.overrides]
 */
function scoreCandidate(input) {
  const hero = normalizeHeroKey(input.hero);
  const teamHeroes = input.teamHeroes || [];
  const enemyHeroes = input.enemyHeroes || [];
  const overrides = input.overrides || {};

  const base = scoreDraftPick({
    candidateHero: hero,
    teamHeroes,
    enemyHeroes,
  });

  let score = base.score;
  const reasons = [...base.reasons];

  // Rakip pickleri: aday, rakibin counter listesinde mi?
  for (const enemy of enemyHeroes) {
    if (countersOf(enemy, overrides).includes(hero)) {
      score += 16;
      reasons.push(heroDisplayName(enemy) + " için iyi cevap");
    }
  }

  // Ters yon: adayi counter'layan bir rakip zaten secilmis mi?
  const ownCounters = countersOf(hero, overrides);
  for (const enemy of enemyHeroes) {
    if (ownCounters.includes(enemy)) {
      score -= 14;
      reasons.push(heroDisplayName(enemy) + " bu seçime karşı güçlü");
    }
  }

  const affinity = playerAffinity(
    input.player || null,
    input.stats || null,
    hero,
  );
  score += affinity.score;
  reasons.push(...affinity.reasons);

  // Rakibin tasidigi ozellige cevap veren hero (ornek: debuff'a karsi
  // dispel). Gerekce listenin BASINA yazilir; dort gerekcelik sinirda
  // kesilirse "neden bu hero" sorusunun asil cevabi kaybolurdu.
  for (const threat of input.enemyThreats || []) {
    if (!threat.answerHeroes.includes(hero)) {
      continue;
    }
    score += Math.min(
      ANSWER_BONUS_MAX,
      ANSWER_BONUS_BASE + ANSWER_BONUS_PER_HERO * threat.heroes.length,
    );
    reasons.unshift(
      threat.answerReason +
        ": " +
        threat.heroes.map(heroDisplayName).join(", "),
    );
  }

  const metrics = base.draftMetrics;
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
 * Taninan oyunculari pozisyonlara esler.
 *
 * Once oyuncunun BU MACTAKI pozisyonu (`role`; Overwolf verdiyse oradan,
 * yoksa kadrodaki birincil rol), sonra ikincil rolleri denenir.
 *
 * @param {Array<{ player: Record<string, any>, role?: string, stats?: Object }>} knownPlayers
 * @returns {Map<string, { player: Record<string, any>, role?: string, stats?: Object }>}
 */
function assignPlayers(knownPlayers) {
  const assigned = new Map();
  const usedPlayers = new Set();
  /** @param {(row: Record<string, any>, slot: string) => boolean} fits */
  const pass = (fits) => {
    for (const slot of ROLE_KEYS) {
      if (assigned.has(slot)) {
        continue;
      }
      const match = knownPlayers.find(
        (row) => !usedPlayers.has(row.player.id) && fits(row, slot),
      );
      if (match) {
        assigned.set(slot, match);
        usedPlayers.add(match.player.id);
      }
    }
  };
  pass(
    (row, slot) =>
      row.role === slot || row.player.dotaProfile?.primaryRole === slot,
  );
  pass((row, slot) =>
    (row.player.dotaProfile?.secondaryRoles || []).includes(slot),
  );
  return assigned;
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
 * @param {Record<string, Record<string, any>>} [input.heroOverrides] hero ->
 *   duzenleme; rol, counter ve ozellikler kullanicinin kaydina gore okunur
 */
export function buildDraftAdvice(input = {}) {
  const myTeam = input.myTeam === "dire" ? "dire" : "radiant";
  const overrides = input.heroOverrides || {};
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
  // Rakip picklerin tasidigi ve bir HERO cevabi olan ozellikler (Debuff ->
  // dispel hero'lari). Katalogdan okunur: kullanicinin isaretledigi kutucuk
  // tohumu ezer.
  const enemyThreats = detectThreats(
    enemyHeroes.map((hero) => ({ hero })),
    overrides,
  ).filter((threat) => threat.answerHeroes.length);

  const unavailable = new Set([
    ...teamHeroes,
    ...enemyHeroes,
    ...bans.map((row) => normalizeHeroKey(row.hero)),
  ]);

  // Taninan oyuncular kendi takimimizda olanlarla sinirlanir.
  const knownPlayers = (
    Array.isArray(input.knownPlayers) ? input.knownPlayers : []
  ).filter((row) => row?.player && (!row.team || row.team === myTeam));
  const assigned = assignPlayers(knownPlayers);

  const candidates = heroKeys().filter((hero) => !unavailable.has(hero));

  const blocks = ROLE_KEYS.map((slot) => {
    const owner = assigned.get(slot) || null;
    const suggestions = candidates
      .filter((hero) => heroSlots(hero, overrides).has(slot))
      .map((hero) =>
        scoreCandidate({
          hero,
          teamHeroes,
          enemyHeroes,
          player: owner?.player || null,
          stats: owner?.stats || null,
          enemyThreats,
          overrides,
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
        " pickine göre güncellendi. Seçilen hero'nun hangi pozisyona alındığı kesin bilinmediği için pick bitene kadar tüm pozisyonlar gösterilir.",
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
    knownPlayerCount: knownPlayers.length,
    notes,
    blocks,
  };
}

export { heroSlots, countersOf };
