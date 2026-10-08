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
 * POZISYONLAR: Overwolf pick sirasinda her oyuncunun pozisyonunu tahmin eder
 * ve bu tahmin genelde dogrudur. O bilgi varsa (`lineup`) takim arkadasinin
 * hero'yu hangi pozisyon icin aldigi BILINIR ve o pozisyon "dolu" gosterilir.
 * Bilinmiyorsa pozisyon acik kalir: secilen bir hero'nun hangi pozisyona
 * alindigini hero'ya bakarak tahmin etmek yaniltiyordu (Pudge pos3 alinmis,
 * pos5 dolu sanilmis, asil bos pozisyonun onerisi kaybolmustu).
 *
 * PICK ONCESI OLASI OYUNCULAR: macta kimligi gorunmeyen ama online olan
 * kadro oyunculari (bkz. match-context `probablePlayers`) bos kalan
 * pozisyonlara "olasi" olarak yerlesir; havuz puanlari yarim agirlikla
 * sayilir. Takimdan ilk pick geldiginde devreden cikarlar.
 *
 * CESITLILIK: her pozisyonun ilk dort onerisinin ardindan bir BESINCI oneri
 * gelir: o pozisyondaki oyuncunun havuzundan listede olmayan bir hero, yoksa
 * ilk dorde en az benzeyen makul bir aday (bkz. `pickVariety`).
 *
 * AYNI HERO IKI POZISYONDA ONERILMEZ. Her hero en iyi puani aldigi pozisyona
 * yerlesir (bkz. `distributeSuggestions`); boylece pos4 ile pos5 ayni destek
 * listesini, pos1 ile pos2 ayni core listesini tekrarlamaz.
 *
 * Bu modul saftir: ag istegi yapmaz, dosya okumaz.
 */

import { heroKeys, heroPositions, heroRecord } from "../heroes/hero-catalog.js";
import { heroDisplayName, normalizeHeroKey } from "../heroes/hero-names.js";
import { detectThreats } from "../live/threats.js";
import { shrunkWinRate } from "../players/hero-pool.js";
import { ROLE_KEYS, ROLE_LABELS } from "../players/player-types.js";
import { getDraftMetrics, scoreDraftPick } from "./draft-analyzer.js";

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
 * Hero'nun ASIL pozisyonu (katalogdaki ilk lane rolu) icin bonus; yalnizca
 * o pozisyonda oynanan uzman hero'lara ek bonus. Cok pozisyonlu bir hero'nun
 * ikincil pozisyonu hafif geri itilir. Amac: pos4 listesinde "pos4 de
 * oynanabilen" bir pos5 hero'su degil, gercek bir pos4 hero'su one ciksin.
 */
const PRIMARY_POSITION_BONUS = 8;
const SPECIALIST_BONUS = 4;
const OFF_POSITION_PENALTY = 4;

/** Rakipte bu adayi counter'layan her hero icin ceza. */
const COUNTERED_PENALTY = 20;

/**
 * Pick oncesi "olasi" (online ama macta kimligi gorunmeyen) oyuncunun hero
 * havuzu puaninin agirligi. Gercekten macta olup olmadigi bilinmiyor; tam
 * agirlik verilseydi yanlis kisinin havuzu oneriyi yonetebilirdi.
 */
const PROBABLE_AFFINITY_WEIGHT = 0.5;

/**
 * Cesitlilik onerisinin ilk dortten en fazla ne kadar dusuk puanli
 * olabilecegi: listedeki en dusuk puanin bu orani, en az VARIETY_MIN_GAP.
 * Amac farkli ama MAKUL bir secenek; listenin dibindeki hero degil.
 */
const VARIETY_SCORE_RATIO = 0.35;
const VARIETY_MIN_GAP = 6;

/** Cesitlilik icin karsilastirilan draft ozellikleri ve okunur adlari. */
const VARIETY_METRICS = {
  teamfight: "takım savaşı",
  tempo: "tempo",
  scaling: "geç oyun",
  pushPotential: "push",
  saveMechanics: "kurtarma",
  catchPotential: "yakalama",
};

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
 * Hero'nun bu pozisyona ne kadar "ait" oldugu.
 *
 * @param {string} heroKey
 * @param {string} slot "pos1".."pos5"
 * @param {Record<string, Record<string, any>>} [overrides]
 * @returns {number}
 */
function positionFit(heroKey, slot, overrides = {}) {
  const positions = [...heroSlots(heroKey, overrides)];
  if (!positions.includes(slot)) {
    return 0;
  }
  if (positions[0] === slot) {
    return (
      PRIMARY_POSITION_BONUS + (positions.length === 1 ? SPECIALIST_BONUS : 0)
    );
  }
  return positions.length >= 3 ? -OFF_POSITION_PENALTY : 0;
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
 * @param {string} [input.slot] Adayin puanlandigi pozisyon
 * @param {boolean} [input.probable] Pozisyondaki oyuncu yalnizca "olasi"
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
      score -= COUNTERED_PENALTY;
      reasons.push(heroDisplayName(enemy) + " bu seçime karşı güçlü");
    }
  }

  const affinity = playerAffinity(
    input.player || null,
    input.stats || null,
    hero,
  );
  score += input.probable
    ? affinity.score * PROBABLE_AFFINITY_WEIGHT
    : affinity.score;
  reasons.push(...affinity.reasons);

  if (input.slot) {
    score += positionFit(hero, input.slot, overrides);
  }

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
 * Taninan oyunculari ACIK pozisyonlara esler.
 *
 * Sira: once oyuncunun BU MACTAKI pozisyonu (`matchRole`, Overwolf), sonra
 * kadrodaki birincil rolu, en son ikincil rolleri. Overwolf'un verdigi
 * pozisyon kesin sayilir: o oyuncu baska bir pozisyona tahminle yerlestirilmez.
 *
 * ESKIDEN ilk tur "macta pos3 VEYA birincil rolu pos1" diye tek kosuldu;
 * pozisyonlar sirayla gezildigi icin bu macta pos3 oynayan (normalde pos1)
 * oyuncu pos1'e oturuyordu.
 *
 * @param {Array<{ player: Record<string, any>, role?: string, matchRole?: string, stats?: Object }>} knownPlayers
 * @param {string[]} [slots] Acik pozisyonlar
 * @returns {Map<string, { player: Record<string, any>, role?: string, stats?: Object }>}
 */
function assignPlayers(knownPlayers, slots = ROLE_KEYS) {
  const assigned = new Map();
  const usedPlayers = new Set();
  /** @param {(row: Record<string, any>, slot: string) => boolean} fits */
  const pass = (fits) => {
    for (const slot of slots) {
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
  pass((row, slot) => row.matchRole === slot);
  pass(
    (row, slot) =>
      !row.matchRole &&
      (row.role === slot || row.player.dotaProfile?.primaryRole === slot),
  );
  pass(
    (row, slot) =>
      !row.matchRole &&
      (row.player.dotaProfile?.secondaryRoles || []).includes(slot),
  );
  return assigned;
}

/**
 * Puanlanmis adaylari pozisyonlara dagitir; AYNI HERO YALNIZCA BIR
 * pozisyonda onerilir.
 *
 * Tum (pozisyon, hero) ciftleri puana gore siralanir ve en yuksekten baslanir:
 * hero en iyi puani aldigi pozisyona yerlesir, o pozisyon doluysa bir
 * sonrakine. Oyuncunun imza kahramani boylece kendi pozisyonunda cikar;
 * pos4/pos5 gibi ortak havuzlu pozisyonlar ayni listeyi tekrarlamaz.
 *
 * @param {Map<string, Array<{ hero: string, score: number }>>} scoredBySlot
 * @param {number} perSlot
 * @returns {Map<string, Array<Record<string, any>>>}
 */
function distributeSuggestions(scoredBySlot, perSlot) {
  const pairs = [];
  for (const [slot, rows] of scoredBySlot) {
    for (const row of rows) {
      pairs.push({ slot, row });
    }
  }
  pairs.sort((a, b) => b.row.score - a.row.score);

  const out = new Map([...scoredBySlot.keys()].map((slot) => [slot, []]));
  const used = new Set();
  for (const { slot, row } of pairs) {
    const list = out.get(slot);
    if (used.has(row.hero) || list.length >= perSlot) {
      continue;
    }
    list.push(row);
    used.add(row.hero);
  }
  return out;
}

/**
 * Hero'nun cesitlilik icin karsilastirilan ozellik vektoru (1..10).
 * @param {string} hero
 * @returns {Record<string, number>}
 */
function varietyVector(hero) {
  const metrics = getDraftMetrics(hero);
  const out = {};
  for (const key of Object.keys(VARIETY_METRICS)) {
    out[key] = Number(metrics[key] || 5);
  }
  return out;
}

/**
 * Iki hero'nun oyun tarzi farki (0 = ayni profil).
 * @param {Record<string, number>} a
 * @param {Record<string, number>} b
 * @returns {number}
 */
function styleDistance(a, b) {
  let sum = 0;
  for (const key of Object.keys(VARIETY_METRICS)) {
    sum += (a[key] - b[key]) ** 2;
  }
  return Math.sqrt(sum);
}

/**
 * Oyuncunun havuzundaki hero'lar: imza, tercih, deneme ve son maclarda en az
 * iki kez oynananlar. Zayif oldugu hero'lar disarida kalir.
 *
 * @param {{ player: Record<string, any>, stats?: Object|null }|null} owner
 * @returns {Set<string>}
 */
function poolOf(owner) {
  const profile = owner?.player?.dotaProfile || {};
  const weak = new Set((profile.weakHeroes || []).map(normalizeHeroKey));
  const heroes = [
    ...(profile.signatureHeroes || []),
    ...(profile.preferredHeroes || []),
    ...(profile.experimentalHeroes || []),
    ...(owner?.stats?.heroes || [])
      .filter((row) => Number(row?.matches || 0) >= 2)
      .map((row) => row.hero),
  ].map(normalizeHeroKey);
  return new Set(heroes.filter((hero) => hero && !weak.has(hero)));
}

/**
 * Pozisyonun BESINCI, cesitlilik onerisi.
 *
 * Ilk dort oneri ayni puanlama mantigindan geldigi icin cogu zaman birbirine
 * benzer (hepsi teamfight'i yuksek hero'lar gibi). Bu oneri bilerek farkli
 * bir kapi acar:
 *
 *   1. Pozisyonda bir oyuncu varsa onun HAVUZUNDAN, listede olmayan en iyi
 *      puanli hero. Oyuncunun rahat oynadigi bir secenek hep gorunur kalir.
 *   2. Yoksa (ya da havuzdan aday kalmadiysa), puani ilk dorde yakin
 *      adaylardan oyun tarzi onlara EN AZ benzeyen.
 *
 * @param {Array<Record<string, any>>} rows Pozisyondaki tum puanli adaylar
 * @param {Array<Record<string, any>>} chosen Ilk dort oneri
 * @param {Set<string>} used Baska yerde onerilmis hero'lar
 * @param {{ player: Record<string, any>, stats?: Object|null }|null} owner
 * @returns {Record<string, any>|null}
 */
function pickVariety(rows, chosen, used, owner) {
  const free = rows.filter((row) => !used.has(row.hero));
  if (!free.length) {
    return null;
  }

  const pool = poolOf(owner);
  const fromPool = free
    .filter((row) => pool.has(row.hero))
    .sort((a, b) => b.score - a.score)[0];
  if (fromPool) {
    return {
      ...fromPool,
      variety: "pool",
      varietyLabel: owner.player.name + " havuzundan",
    };
  }

  if (!chosen.length) {
    return null;
  }
  const lowest = Math.min(...chosen.map((row) => row.score));
  const floor =
    lowest - Math.max(VARIETY_MIN_GAP, Math.abs(lowest) * VARIETY_SCORE_RATIO);
  const chosenVectors = chosen.map((row) => varietyVector(row.hero));

  let best = null;
  for (const row of free) {
    // Eksi puanli aday (counter'lanmis, oyuncunun zayif hero'su) "farkli"
    // diye onerilmez.
    if (row.score < floor || row.score <= 0) {
      continue;
    }
    const vector = varietyVector(row.hero);
    // Listedeki EN YAKIN hero'ya uzaklik: birine bile cok benziyorsa
    // "farkli" sayilmaz.
    const distance = Math.min(
      ...chosenVectors.map((other) => styleDistance(vector, other)),
    );
    if (
      !best ||
      distance > best.distance ||
      (distance === best.distance && row.score > best.row.score)
    ) {
      best = { row, vector, distance };
    }
  }
  if (!best || best.distance <= 0) {
    return null;
  }

  // Farki en cok yaratan ozellik okunur bir etiket olarak yazilir.
  const lead = Object.keys(VARIETY_METRICS)
    .map((key) => {
      const average =
        chosenVectors.reduce((sum, vector) => sum + vector[key], 0) /
        chosenVectors.length;
      return { key, gap: best.vector[key] - average };
    })
    .sort((a, b) => b.gap - a.gap)[0];
  return {
    ...best.row,
    variety: "different",
    varietyLabel:
      lead.gap > 0
        ? "Farklı tarz: daha çok " + VARIETY_METRICS[lead.key]
        : "Farklı tarz",
  };
}

/**
 * Draft onerisini uretir.
 *
 * @param {Object} input
 * @param {"radiant"|"dire"} [input.myTeam] Onerinin kimin icin uretilecegi
 * @param {Array<{ hero: string, team: string }>} [input.picks]
 * @param {Array<{ hero: string, team: string }>} [input.bans]
 * @param {string} [input.phase] GSI `map.game_state`
 * @param {Array<{ player: import("../players/player-types.js").Player, team?: string, role?: string, matchRole?: string, hero?: string, stats?: Object }>} [input.knownPlayers]
 * @param {Array<{ team?: string, position: number, hero?: string, heroConfirmed?: boolean, name?: string }>} [input.lineup]
 *   Takimin Overwolf'tan gelen pozisyon dizilimi (kadroda olmayanlar dahil)
 * @param {number} [input.suggestionsPerRole]
 * @param {Record<string, Record<string, any>>} [input.heroOverrides] hero ->
 *   duzenleme; rol, counter ve ozellikler kullanicinin kaydina gore okunur
 * @param {Array<{ player: import("../players/player-types.js").Player, role?: string, stats?: Object }>} [input.probablePlayers]
 *   Pick ONCESI macta olabilecek (online) kadro oyunculari; kesin bilinen
 *   oyuncular yerlestikten sonra bos pozisyonlara "olasi" olarak atanir
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

  // Takimimizin pozisyon dizilimi (Overwolf'un pick sirasindaki tahmini).
  // Pozisyonu ve ONAYLI hero'su bilinen oyuncunun pozisyonu doludur.
  const lineup = (Array.isArray(input.lineup) ? input.lineup : []).filter(
    (row) =>
      row &&
      (!row.team || row.team === myTeam) &&
      row.position >= 1 &&
      row.position <= 5,
  );
  /** @type {Map<string, { hero: string, heroName: string, playerName: string }>} */
  const filled = new Map();
  /** @type {Map<string, string>} pozisyon -> oyuncu adi (kadroda olmasa da) */
  const lineupNames = new Map();
  for (const row of lineup) {
    const slot = "pos" + row.position;
    if (row.name && !lineupNames.has(slot)) {
      lineupNames.set(slot, String(row.name));
    }
    const hero = normalizeHeroKey(row.hero || "");
    const picked =
      hero &&
      row.heroConfirmed !== false &&
      (teamHeroes.includes(hero) || row.heroConfirmed === true);
    if (picked && !filled.has(slot)) {
      filled.set(slot, {
        hero,
        heroName: heroDisplayName(hero),
        playerName: String(row.name || ""),
      });
    }
  }
  const openSlots = ROLE_KEYS.filter((slot) => !filled.has(slot));

  // Taninan oyuncular kendi takimimizda olanlarla sinirlanir. Hero'sunu
  // zaten secmis olan oyuncu bos bir pozisyona atanmaz.
  const knownPlayers = (
    Array.isArray(input.knownPlayers) ? input.knownPlayers : []
  ).filter((row) => row?.player && (!row.team || row.team === myTeam));
  const unpickedPlayers = knownPlayers.filter(
    (row) => !row.hero || !teamHeroes.includes(normalizeHeroKey(row.hero)),
  );
  const assigned = assignPlayers(unpickedPlayers, openSlots);

  // Pick oncesi: kesin bilinen oyunculardan bos kalan pozisyonlara online
  // arkadaslar "olasi" olarak yerlesir. Takimdan ilk pick gelince devreden
  // cikarlar; o noktada lobidekiler macin kendisinden okunuyor.
  const knownIds = new Set(knownPlayers.map((row) => row.player.id));
  const probablePlayers =
    stage === "pre" && Array.isArray(input.probablePlayers)
      ? input.probablePlayers.filter(
          (row) => row?.player && !knownIds.has(row.player.id),
        )
      : [];
  const probableAssigned = assignPlayers(
    probablePlayers,
    openSlots.filter((slot) => !assigned.has(slot)),
  );
  for (const [slot, row] of probableAssigned) {
    assigned.set(slot, { ...row, probable: true });
  }

  const candidates = heroKeys().filter((hero) => !unavailable.has(hero));

  const scoredBySlot = new Map(
    openSlots.map((slot) => {
      const owner = assigned.get(slot) || null;
      const rows = candidates
        .filter((hero) => heroSlots(hero, overrides).has(slot))
        .map((hero) =>
          scoreCandidate({
            hero,
            slot,
            teamHeroes,
            enemyHeroes,
            player: owner?.player || null,
            stats: owner?.stats || null,
            probable: Boolean(owner?.probable),
            enemyThreats,
            overrides,
          }),
        );
      return [slot, rows];
    }),
  );
  const suggestionsBySlot = distributeSuggestions(
    scoredBySlot,
    suggestionsPerRole,
  );

  // Cesitlilik onerisi (besinci). Baska bir pozisyonda onerilen hero burada
  // tekrar cikmaz.
  const usedHeroes = new Set(
    [...suggestionsBySlot.values()].flat().map((row) => row.hero),
  );
  for (const slot of openSlots) {
    const variety = pickVariety(
      scoredBySlot.get(slot) || [],
      suggestionsBySlot.get(slot) || [],
      usedHeroes,
      assigned.get(slot) || null,
    );
    if (variety) {
      suggestionsBySlot.get(slot).push(variety);
      usedHeroes.add(variety.hero);
    }
  }

  const blocks = ROLE_KEYS.map((slot) => {
    const owner = assigned.get(slot) || null;
    const lineupName = lineupNames.get(slot) || "";
    const player = owner
      ? {
          id: owner.player.id,
          name: owner.player.name,
          ...(owner.probable ? { probable: true } : {}),
        }
      : lineupName
        ? { id: "", name: lineupName, guest: true }
        : null;
    return {
      role: slot,
      roleLabel: ROLE_LABELS[slot] || slot,
      player,
      filled: filled.get(slot) || null,
      suggestions: suggestionsBySlot.get(slot) || [],
    };
  });

  const notes = [];
  if (stage === "pre") {
    notes.push(
      knownPlayers.length || probableAssigned.size
        ? "Pick başlamadı. Öneriler lobideki tanınan oyuncuların hero havuzuna göre sıralandı."
        : "Pick başlamadı. Lobide tanınan oyuncu yok; öneriler genel rol dengesine göre sıralandı.",
    );
    if (probableAssigned.size) {
      notes.push(
        probableAssigned.size +
          " online arkadaş maçta olabilir diye boş pozisyonlara yerleştirildi; hero havuzları yarım ağırlıkla sayıldı.",
      );
    }
  } else {
    notes.push(
      "Öneriler kendi " +
        teamHeroes.length +
        " pickinize ve rakibin " +
        enemyHeroes.length +
        " pickine göre güncellendi.",
    );
  }
  if (lineup.length) {
    notes.push(
      "Pozisyonlar Overwolf'un pick sırasındaki tahminine göre. Bir hero yalnızca en uygun olduğu pozisyonda önerilir.",
    );
  } else if (teamHeroes.length) {
    notes.push(
      "Seçilen hero'ların hangi pozisyona alındığı bilinmediği için pick bitene kadar tüm pozisyonlar açık gösterilir.",
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
    probablePlayerCount: probableAssigned.size,
    notes,
    blocks,
  };
}

export { heroSlots, countersOf };
