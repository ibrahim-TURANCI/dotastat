/**
 * PerformanceEvaluationEngine
 *
 * Bir macta oyuncunun yaklasik hangi seviyede oynadigini tahmin eder.
 * Sonuc GERCEK MMR DEGILDIR; "Performance Rank" tahminidir.
 *
 * Calisma mantigi:
 *
 *   1. Beklenti tabani (baseline), oyuncunun performanceProfile'indan ve
 *      oynadigi heronun onun havuzundaki yerinden turetilir.
 *      Signature hero -> strongHeroPerformance, bilinmeyen hero ->
 *      averageHeroPerformance, weak hero -> weakHeroPerformance.
 *
 *   2. Rol grubuna gore (core / support) farkli faktorler ve agirliklar
 *      kullanilir. Support icin vision ve fight katkisi agir basar, core icin
 *      farm verimliligi ve objective. Boylece 1/3/33 support iyi, 14/2/5 ama
 *      fight'a katilmamis carry dusuk puan alabilir.
 *
 *   3. Her faktor -1..+1 arasinda normalize edilir, agirlikli toplami
 *      baseline uzerine SCORE_SPREAD ile eklenir.
 *
 *   4. Mac baglami (takim onde/geride, lane sonucu) sonucu yumusatir.
 *
 * Tum esik degerleri BENCHMARKS / WEIGHTS tablolarindadir; fonksiyon icinde
 * magic number yoktur ve oyuncuya ozel dallanma bulunmaz.
 */

import {
  ROLE_GROUP,
  ROLE_SHORT_LABELS,
  normalizeRoleKey,
} from "./player-types.js";
import { normalizeHeroKey } from "./player-normalizer.js";

/** Faktor toplaminin rank'e cevrilmesindeki genlik. */
const SCORE_SPREAD = 1400;
const MIN_PERFORMANCE_RANK = 200;
const MAX_PERFORMANCE_RANK = 9000;
const DEFAULT_BASELINE = { min: 2000, max: 3000 };
const REFERENCE_MATCH_MINUTES = 38;

/**
 * Rol grubuna gore "orta seviye" referans degerleri.
 * Bir faktor bu degerin uzerindeyse pozitif, altindaysa negatif skor uretir.
 */
const BENCHMARKS = {
  core: {
    gpm: 520,
    xpm: 560,
    lastHitsPerMinute: 6.5,
    heroDamagePerMinute: 700,
    towerDamage: 4000,
    deathsPerHour: 8,
    fightParticipation: 0.6,
    wardsPerMinute: 0.05,
  },
  support: {
    gpm: 300,
    xpm: 360,
    lastHitsPerMinute: 1.5,
    heroDamagePerMinute: 380,
    towerDamage: 1200,
    deathsPerHour: 11,
    fightParticipation: 0.72,
    wardsPerMinute: 0.55,
  },
};

/**
 * Faktor agirliklari. Toplam 1.0 olacak sekilde tanimlanir.
 * Role-aware degerlendirmenin kalbi burasidir.
 */
const WEIGHTS = {
  core: {
    farmEfficiency: 0.24,
    damageContribution: 0.18,
    fightParticipation: 0.16,
    survivability: 0.16,
    objectiveContribution: 0.14,
    laneOutcome: 0.12,
  },
  support: {
    fightParticipation: 0.24,
    visionContribution: 0.22,
    survivability: 0.18,
    damageContribution: 0.14,
    objectiveContribution: 0.11,
    laneOutcome: 0.11,
  },
};

/** Hero havuzu kademesi -> hangi performans araligini beklemeliyiz. */
const HERO_TIER_BASELINE = {
  signature: "strongHeroPerformance",
  preferred: "strongHeroPerformance",
  experimental: "averageHeroPerformance",
  unknown: "averageHeroPerformance",
  weak: "weakHeroPerformance",
};

/** Hero havuzu kademesi -> heroFit degeri. */
const HERO_TIER_FIT = {
  signature: "excellent",
  preferred: "good",
  experimental: "neutral",
  unknown: "neutral",
  weak: "poor",
};

/** Mac baglaminin skora etkisi (geride kalan takimda iyi oynamak daha degerli). */
const GAME_STATE_MODIFIER = {
  ahead: -0.06,
  even: 0,
  behind: 0.08,
};

/** Rolun nereden geldigi (UI'da acikca gosterilir). */
const ROLE_SOURCE_LABELS = {
  manual: "elle secildi",
  provider: "mac verisinden",
  inferred: "istatistikten cikarildi",
  profile: "oyuncu profilinden",
};

/** Rol bilgisi eksik maclarda grubu tahmin etmek icin kullanilan esikler. */
const ROLE_INFERENCE = {
  wardsSupport: 4,
  wardsHardSupport: 9,
  lastHitsSupportMax: 3,
  lastHitsCoreMin: 4.5,
  gpmSupportMax: 380,
  gpmCoreMin: 450,
  gpmHardSupportMax: 280,
};

const LANE_RESULT_SCORE = {
  won: 0.7,
  draw: 0,
  lost: -0.7,
};

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Bir olcumu referansa gore -1..+1 araligina tasir.
 * @param {number} value
 * @param {number} benchmark
 * @param {{ inverse?: boolean, tolerance?: number }} [options]
 * @returns {number}
 */
function scoreAgainstBenchmark(value, benchmark, options = {}) {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(benchmark) ||
    benchmark <= 0
  ) {
    return 0;
  }
  const tolerance = Number(options.tolerance) || 0.5;
  const ratio = (value - benchmark) / (benchmark * tolerance);
  const score = clamp(ratio, -1, 1);
  return options.inverse ? -score : score;
}

/**
 * @param {import("./player-types").PlayerMatch} match
 * @returns {number}
 */
function matchMinutes(match) {
  const seconds = Number(match?.durationSeconds || 0);
  return seconds > 0 ? seconds / 60 : REFERENCE_MATCH_MINUTES;
}

/**
 * Macta dikilen toplam ward sayisi; saglayici bu veriyi vermediyse `null`.
 *
 * OpenDota'nin oyuncu mac uclari obs/sen alanlarini dondurmez (yalnizca parse
 * edilmis maclarin detayinda vardir). GSI'dan gelen canli veride ise gercek
 * sayilar bulunabilir. Bu yuzden ayrim veri katmaninda degil burada yapilir:
 * iki alan da yoksa bilinmiyor, en az biri varsa toplanabilir.
 *
 * @param {import("./player-types").PlayerMatch} match
 * @returns {number|null}
 */
function knownWardTotal(match) {
  const obs = match?.obsPlaced;
  const sen = match?.senPlaced;
  const obsKnown =
    obs !== null && obs !== undefined && Number.isFinite(Number(obs));
  const senKnown =
    sen !== null && sen !== undefined && Number.isFinite(Number(sen));
  if (!obsKnown && !senKnown) {
    return null;
  }
  return (obsKnown ? Number(obs) : 0) + (senKnown ? Number(sen) : 0);
}

/**
 * Oyuncunun hero havuzunda bu hero nerede duruyor?
 * @param {import("./player-types").Player|null} player
 * @param {string} heroKey
 * @returns {"signature"|"preferred"|"experimental"|"weak"|"unknown"}
 */
function resolveHeroTier(player, heroKey) {
  const hero = normalizeHeroKey(heroKey);
  const profile = player?.dotaProfile;
  if (!hero || !profile) {
    return "unknown";
  }
  if (profile.signatureHeroes.includes(hero)) return "signature";
  if (profile.weakHeroes.includes(hero)) return "weak";
  if (profile.preferredHeroes.includes(hero)) return "preferred";
  if (profile.experimentalHeroes.includes(hero)) return "experimental";
  return "unknown";
}

/**
 * @param {import("./player-types").Player|null} player
 * @param {import("./player-types").RoleKey|""} role
 * @returns {import("./player-types").FitLevel}
 */
function resolveRoleFit(player, role) {
  const profile = player?.dotaProfile;
  if (!role || !profile?.primaryRole) {
    return "neutral";
  }
  if (profile.primaryRole === role) {
    return "excellent";
  }
  if (profile.secondaryRoles.includes(role)) {
    return "good";
  }
  const sameGroup = ROLE_GROUP[profile.primaryRole] === ROLE_GROUP[role];
  return sameGroup ? "neutral" : "poor";
}

/**
 * Baseline araliginin ortasi.
 * @param {import("./player-types").Player|null} player
 * @param {"signature"|"preferred"|"experimental"|"weak"|"unknown"} heroTier
 * @returns {{ center: number, range: { min: number, max: number }, source: string }}
 */
function resolveBaseline(player, heroTier) {
  const key = HERO_TIER_BASELINE[heroTier] || "averageHeroPerformance";
  const range = player?.performanceProfile?.[key];
  const usable =
    range && Number(range.max) > 0
      ? { min: Number(range.min), max: Number(range.max) }
      : null;

  if (usable) {
    return {
      center: (usable.min + usable.max) / 2,
      range: usable,
      source: key,
    };
  }

  const actualRank = Number(player?.performanceProfile?.actualRank || 0);
  if (actualRank > 0) {
    return {
      center: actualRank,
      range: { min: actualRank, max: actualRank },
      source: "actualRank",
    };
  }

  return {
    center: (DEFAULT_BASELINE.min + DEFAULT_BASELINE.max) / 2,
    range: DEFAULT_BASELINE,
    source: "default",
  };
}

/**
 * Rol grubuna gore faktor skorlarini uretir.
 * @param {import("./player-types").PlayerMatch} match
 * @param {"core"|"support"} group
 * @returns {Array<{ key: string, label: string, score: number, weight: number, note: string }>}
 */
function buildFactors(match, group) {
  const bench = BENCHMARKS[group];
  const weights = WEIGHTS[group];
  const minutes = matchMinutes(match);

  const kills = Number(match?.kills || 0);
  const deaths = Number(match?.deaths || 0);
  const assists = Number(match?.assists || 0);
  const teamKills = Number(match?.teamKills || 0);

  const participation =
    teamKills > 0 ? (kills + assists) / teamKills : bench.fightParticipation;
  const deathsPerHour = (deaths / minutes) * 60;
  // null = saglayici ward verisi vermedi. 0 ile karistirilmamali.
  const wardTotal = knownWardTotal(match);
  const wardsPerMinute = wardTotal === null ? null : wardTotal / minutes;
  const heroDamagePerMinute = Number(match?.heroDamage || 0) / minutes;
  const healingPerMinute = Number(match?.heroHealing || 0) / minutes;
  const lastHitsPerMinute = Number(match?.lastHits || 0) / minutes;

  const farmEfficiency =
    (scoreAgainstBenchmark(Number(match?.gpm || 0), bench.gpm) +
      scoreAgainstBenchmark(Number(match?.xpm || 0), bench.xpm) +
      scoreAgainstBenchmark(lastHitsPerMinute, bench.lastHitsPerMinute)) /
    3;

  const damageContribution =
    group === "support"
      ? clamp(
          scoreAgainstBenchmark(
            heroDamagePerMinute + healingPerMinute,
            bench.heroDamagePerMinute,
          ),
          -1,
          1,
        )
      : scoreAgainstBenchmark(heroDamagePerMinute, bench.heroDamagePerMinute);

  /** @type {Array<{ key: string, label: string, score: number, weight: number, note: string }>} */
  const factors = [
    {
      key: "fightParticipation",
      label: "Fight katilimi",
      score: scoreAgainstBenchmark(participation, bench.fightParticipation),
      weight: weights.fightParticipation,
      note: `Takim kill'lerinin %${Math.round(participation * 100)}'ine katildi.`,
    },
    {
      key: "survivability",
      label: "Hayatta kalma",
      score: scoreAgainstBenchmark(deathsPerHour, bench.deathsPerHour, {
        inverse: true,
      }),
      weight: weights.survivability,
      note: `${deaths} olum (saatlik ${deathsPerHour.toFixed(1)}).`,
    },
    {
      key: "damageContribution",
      label: group === "support" ? "Damage / heal katkisi" : "Hero damage",
      score: damageContribution,
      weight: weights.damageContribution,
      note: `Dakika basina ${Math.round(heroDamagePerMinute)} hero damage.`,
    },
    {
      key: "objectiveContribution",
      label: "Objective katkisi",
      score: scoreAgainstBenchmark(
        Number(match?.towerDamage || 0),
        bench.towerDamage,
      ),
      weight: weights.objectiveContribution,
      note: `${Math.round(Number(match?.towerDamage || 0))} tower damage.`,
    },
    {
      key: "laneOutcome",
      label: "Lane sonucu",
      score: LANE_RESULT_SCORE[String(match?.laneResult || "")] ?? 0,
      weight: weights.laneOutcome,
      note: match?.laneResult
        ? `Lane: ${match.laneResult}`
        : "Lane verisi yok.",
    },
  ];

  if (group === "core") {
    factors.push({
      key: "farmEfficiency",
      label: "Farm verimliligi",
      score: farmEfficiency,
      weight: weights.farmEfficiency,
      note: `${Math.round(Number(match?.gpm || 0))} GPM / ${Math.round(Number(match?.xpm || 0))} XPM.`,
    });
  } else if (wardsPerMinute !== null) {
    factors.push({
      key: "visionContribution",
      label: "Vision katkisi",
      score: scoreAgainstBenchmark(wardsPerMinute, bench.wardsPerMinute),
      weight: weights.visionContribution,
      note: `${Number(match?.obsPlaced || 0)} obs / ${Number(match?.senPlaced || 0)} sentry.`,
    });
  }
  // wardsPerMinute === null ise vision faktoru HIC eklenmez. Eskiden 0 ward
  // varsayilip -1 puan veriliyordu ve support agirliginin %22'si her macta
  // bosa gidiyordu (olculdu: mac basina ~250 PR kayip). Eksik veri, kotu
  // performans demek degildir.

  return normalizeWeights(factors);
}

/**
 * Faktor agirliklarini toplami 1.0 olacak sekilde yeniden olcekler.
 *
 * Veri eksikligi yuzunden bir faktor listeden dustugunde kalan agirliklarin
 * toplami 1'in altina duser ve skor yapay olarak notre (0'a) cekilir. Yeniden
 * normalize edince elimizdeki olcutler kendi aralarinda tam agirlik tasir.
 *
 * @template {{ weight: number }} T
 * @param {T[]} factors
 * @returns {T[]}
 */
function normalizeWeights(factors) {
  const total = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (total <= 0 || Math.abs(total - 1) < 1e-9) {
    return factors;
  }
  return factors.map((factor) => ({
    ...factor,
    weight: Number((factor.weight / total).toFixed(4)),
  }));
}

/**
 * Rol bilgisi olmayan maclarda oynanan rolu mac istatistiklerinden tahmin eder.
 *
 * Oyuncunun DOGAL rolune bakmaz; aksi halde core bir oyuncunun support
 * oynadigi mac core olcutleriyle degerlendirilir ve yanlis cikarim uretir.
 *
 * @param {import("./player-types").PlayerMatch} match
 * @returns {{ role: import("./player-types").RoleKey, group: "core"|"support", confident: boolean }}
 */
function inferRoleFromMatch(match) {
  const minutes = matchMinutes(match);
  const wards = knownWardTotal(match);
  const lastHitsPerMinute = Number(match?.lastHits || 0) / minutes;
  const gpm = Number(match?.gpm || 0);

  let supportScore = 0;
  let coreScore = 0;

  // Ward verisi yoksa bu sinyal hic kullanilmaz; "0 ward -> core" cikarimi
  // veri eksikliginde her supportu core sanmaya yol acardi.
  if (wards !== null) {
    if (wards >= ROLE_INFERENCE.wardsSupport) supportScore += 2;
    else if (wards > 0) supportScore += 1;
  }

  if (lastHitsPerMinute > 0) {
    if (lastHitsPerMinute < ROLE_INFERENCE.lastHitsSupportMax)
      supportScore += 2;
    else if (lastHitsPerMinute >= ROLE_INFERENCE.lastHitsCoreMin)
      coreScore += 2;
  }

  if (gpm > 0) {
    if (gpm < ROLE_INFERENCE.gpmSupportMax) supportScore += 2;
    else if (gpm >= ROLE_INFERENCE.gpmCoreMin) coreScore += 2;
  }

  const group = supportScore > coreScore ? "support" : "core";
  const confident = Math.abs(supportScore - coreScore) >= 2;

  if (group === "support") {
    // Cok ward + en dusuk kaynak -> hard support, aksi halde roamer.
    const hardSupport =
      wards >= ROLE_INFERENCE.wardsHardSupport ||
      gpm < ROLE_INFERENCE.gpmHardSupportMax;
    return { role: hardSupport ? "pos5" : "pos4", group, confident };
  }

  return { role: "pos1", group, confident };
}

/**
 * Degerlendirmede kullanilacak rolu belirler.
 *
 * Oncelik: manuel secim > provider verisi > mac istatistiginden cikarim >
 * oyuncunun dogal rolu. Sonuc UI'da kaynagiyla birlikte gosterilir.
 *
 * @param {import("./player-types").PlayerMatch} match
 * @param {import("./player-types").Player|null} player
 * @param {import("./player-types").RoleKey|""} [forcedRole]
 * @returns {{ role: import("./player-types").RoleKey, group: "core"|"support", source: "manual"|"provider"|"inferred"|"profile" }}
 */
function resolveEvaluationRole(match, player, forcedRole) {
  const manual = normalizeRoleKey(forcedRole);
  if (manual) {
    return { role: manual, group: ROLE_GROUP[manual], source: "manual" };
  }

  const fromProvider = normalizeRoleKey(match?.role);
  if (fromProvider) {
    return {
      role: fromProvider,
      group: ROLE_GROUP[fromProvider],
      source: "provider",
    };
  }

  const inferred = inferRoleFromMatch(match);
  if (inferred.confident) {
    return { role: inferred.role, group: inferred.group, source: "inferred" };
  }

  // Cikarim zayifsa oyuncunun dogal rolune duseriz, ama grup cakisiyorsa
  // cikarimin grubunu koruruz (support oynanmis maci core saymamak icin).
  const natural = normalizeRoleKey(player?.dotaProfile?.primaryRole);
  if (natural && ROLE_GROUP[natural] === inferred.group) {
    return { role: natural, group: ROLE_GROUP[natural], source: "profile" };
  }

  return { role: inferred.role, group: inferred.group, source: "inferred" };
}

/**
 * Veri eksikligine gore guven skoru.
 * @param {import("./player-types").PlayerMatch} match
 * @param {"core"|"support"} group
 * @returns {number} 0..1
 */
function resolveConfidence(match, group) {
  const checks = [
    Number(match?.durationSeconds || 0) > 0,
    Number(match?.teamKills || 0) > 0,
    Number(match?.gpm || 0) > 0,
    Number(match?.heroDamage || 0) > 0,
    Boolean(match?.laneResult),
    Boolean(match?.role),
    // Support macinda ward verisi ELDE YOKSA guven duser; bu dogru davranis,
    // cunku vision olcutu olmadan support degerlendirmesi eksiktir. Arayuz
    // bu dusuk guveni gosterip kullaniciya sinyal verir.
    group === "support"
      ? knownWardTotal(match) !== null
      : Number(match?.lastHits || 0) > 0,
  ];
  const known = checks.filter(Boolean).length;
  return Number((known / checks.length).toFixed(2));
}

/**
 * Takimin onde/geride oldugunu mac verisinden turetir.
 * @param {import("./player-types").PlayerMatch} match
 * @returns {import("./player-types").GameState}
 */
function inferGameState(match) {
  const teamKills = Number(match?.teamKills || 0);
  const teamDeaths = Number(match?.teamDeaths || 0);
  if (teamKills <= 0 || teamDeaths <= 0) {
    return "even";
  }
  const ratio = teamKills / teamDeaths;
  if (ratio >= 1.25) return "ahead";
  if (ratio <= 0.8) return "behind";
  return "even";
}

/**
 * Faktorlerden dogal dilde ozet uretir.
 * @param {Object} input
 * @param {Array<{ key: string, label: string, score: number, weight: number, note: string }>} input.factors
 * @param {"core"|"support"} input.group
 * @param {import("./player-types").FitLevel} input.heroFit
 * @param {import("./player-types").FitLevel} input.roleFit
 * @param {import("./player-types").EvaluationContext} input.context
 * @param {number} input.performanceRank
 * @param {number} input.baselineCenter
 * @param {import("./player-types").RoleKey} input.role
 * @param {"manual"|"provider"|"inferred"|"profile"} input.roleSource
 * @returns {{ summary: string, strengths: string[], mistakes: string[] }}
 */
function buildNarrative(input) {
  const sorted = [...input.factors].sort((a, b) => b.score - a.score);
  const strengths = sorted
    .filter((factor) => factor.score > 0.2)
    .slice(0, 3)
    .map((factor) => `${factor.label}: ${factor.note}`);
  const mistakes = sorted
    .filter((factor) => factor.score < -0.2)
    .reverse()
    .slice(0, 3)
    .map((factor) => `${factor.label} beklenenin altinda. ${factor.note}`);

  const delta = input.performanceRank - input.baselineCenter;
  const parts = [];

  // Hangi olcutle bakildigi her zaman ilk cumlede belirtilir; boylece support
  // oynanan bir mac core olcutleriyle degerlendirildiyse hemen fark edilir.
  parts.push(
    `${ROLE_SHORT_LABELS[input.role] || input.role} oynandi ve ${
      input.group === "support" ? "SUPPORT" : "CORE"
    } olcutleriyle degerlendirildi (${
      ROLE_SOURCE_LABELS[input.roleSource] || input.roleSource
    }).`,
  );

  if (delta > 250) {
    parts.push("Bu macta kendi ortalama seviyesinin uzerinde oynadi.");
  } else if (delta < -250) {
    parts.push("Bu macta kendi ortalama seviyesinin altinda kaldi.");
  } else {
    parts.push("Bu macta kendi beklenen seviyesine yakin oynadi.");
  }

  if (input.heroFit === "excellent") {
    parts.push(
      "Signature herolarindan birini oynadi ve tanidik plani uyguladi.",
    );
  } else if (input.heroFit === "poor") {
    parts.push("Hero secimi kendi guclu havuzunun disindaydi.");
  }

  if (input.roleFit === "poor") {
    parts.push(
      "Dogal rolunun disinda oynadi; bu tek basina performansi dusuruyor.",
    );
  }

  if (input.context.gameState === "behind") {
    parts.push(
      input.context.teamWon
        ? "Takim geride kalmasina ragmen oyunu cevirdi."
        : "Takim geride olmasina ragmen katki uretmeye devam etti.",
    );
  } else if (input.context.gameState === "ahead" && !input.context.teamWon) {
    parts.push("Takim onde olmasina ragmen avantaj korunamadi.");
  }

  if (input.group === "core" && strengths.length && mistakes.length) {
    const farmStrong = input.factors.some(
      (factor) => factor.key === "farmEfficiency" && factor.score > 0.3,
    );
    const fightWeak = input.factors.some(
      (factor) => factor.key === "fightParticipation" && factor.score < -0.2,
    );
    if (farmStrong && fightWeak) {
      parts.push(
        "Istatistikleri iyi gorunse de fight katkisinin dusuk olmasi performans rankini asagi cekiyor.",
      );
    }
  }

  if (input.group === "support") {
    const visionStrong = input.factors.some(
      (factor) => factor.key === "visionContribution" && factor.score > 0.3,
    );
    if (visionStrong) {
      parts.push("Vision ve detection rutini takima gorunur avantaj sagladi.");
    }
  }

  return {
    summary: parts.join(" "),
    strengths,
    mistakes,
  };
}

/**
 * Tek bir mac icin oyuncu degerlendirmesi uretir.
 *
 * @param {Object} input
 * @param {import("./player-types").Player|null} input.player
 * @param {import("./player-types").PlayerMatch} input.match
 * @param {Partial<import("./player-types").EvaluationContext>} [input.context]
 * @param {import("./player-types").RoleKey|""} [input.forcedRole] Elle secilen rol
 * @returns {import("./player-types").PerformanceEvaluation|null}
 */
function evaluateMatchPlayer(input) {
  const match = input?.match;
  if (!match || !match.matchId) {
    return null;
  }

  const player = input.player || null;
  const resolvedRole = resolveEvaluationRole(match, player, input.forcedRole);
  const role = resolvedRole.role;
  const group = resolvedRole.group;

  const heroTier = resolveHeroTier(player, match.hero);
  const heroFit = /** @type {import("./player-types").FitLevel} */ (
    HERO_TIER_FIT[heroTier]
  );
  const roleFit = resolveRoleFit(player, role);
  const baseline = resolveBaseline(player, heroTier);

  const factors = buildFactors(match, group);
  const weightedScore = factors.reduce(
    (total, factor) => total + factor.score * factor.weight,
    0,
  );

  /** @type {import("./player-types").EvaluationContext} */
  const context = {
    teamWon:
      input.context?.teamWon !== undefined
        ? Boolean(input.context.teamWon)
        : match.result === "win",
    gameState: input.context?.gameState || inferGameState(match),
    laneResult:
      input.context?.laneResult ||
      (match.laneResult ? match.laneResult : undefined),
  };

  const contextModifier = GAME_STATE_MODIFIER[context.gameState] || 0;
  const adjustedScore = clamp(weightedScore + contextModifier, -1, 1);

  const performanceRank = Math.round(
    clamp(
      baseline.center + adjustedScore * SCORE_SPREAD,
      MIN_PERFORMANCE_RANK,
      MAX_PERFORMANCE_RANK,
    ),
  );

  const narrative = buildNarrative({
    factors,
    group,
    heroFit,
    roleFit,
    context,
    performanceRank,
    baselineCenter: baseline.center,
    roleSource: resolvedRole.source,
    role,
  });

  return {
    playerId: String(player?.id || match.playerId || ""),
    matchId: String(match.matchId),
    performanceRank,
    role,
    roleGroup: group,
    roleSource: resolvedRole.source,
    confidence: resolveConfidence(match, group),
    summary: narrative.summary,
    strengths: narrative.strengths,
    mistakes: narrative.mistakes,
    heroFit,
    roleFit,
    context,
    createdAt: new Date().toISOString(),
    breakdown: factors.map((factor) => ({
      key: factor.key,
      label: factor.label,
      score: Number(factor.score.toFixed(3)),
      weight: factor.weight,
      note: factor.note,
    })),
  };
}

/**
 * Bir oyuncunun mac listesini toplu degerlendirir.
 * @param {Object} input
 * @param {import("./player-types").Player|null} input.player
 * @param {import("./player-types").PlayerMatch[]} input.matches
 * @param {Record<string, import("./player-types").RoleKey>} [input.forcedRoles] matchId -> rol
 * @returns {import("./player-types").PerformanceEvaluation[]}
 */
function evaluateMatches(input) {
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const forcedRoles = input?.forcedRoles || {};
  return matches
    .map((match) =>
      evaluateMatchPlayer({
        player: input.player,
        match,
        forcedRole: forcedRoles[match?.matchId] || "",
      }),
    )
    .filter(
      /** @returns {row is import("./player-types").PerformanceEvaluation} */
      (row) => row !== null,
    );
}

/**
 * Son maclardan form ozeti cikarir (oyuncu kartinda gosterilir).
 * @param {import("./player-types").PerformanceEvaluation[]} evaluations
 * @param {import("./player-types").PlayerMatch[]} matches
 * @returns {{ averagePerformanceRank: number, matches: number, wins: number, winRate: number, trend: "up"|"down"|"flat", form: Array<"win"|"loss"> }}
 */
function summarizeForm(evaluations, matches) {
  const rows = Array.isArray(evaluations) ? evaluations : [];
  const matchRows = Array.isArray(matches) ? matches : [];
  const wins = matchRows.filter((row) => row?.result === "win").length;

  if (!rows.length) {
    return {
      averagePerformanceRank: 0,
      matches: matchRows.length,
      wins,
      winRate: matchRows.length
        ? Number((wins / matchRows.length).toFixed(4))
        : 0,
      trend: "flat",
      form: matchRows.map((row) => (row?.result === "win" ? "win" : "loss")),
    };
  }

  const average =
    rows.reduce((total, row) => total + Number(row.performanceRank || 0), 0) /
    rows.length;

  const half = Math.max(1, Math.floor(rows.length / 2));
  const recentAverage =
    rows.slice(0, half).reduce((t, r) => t + r.performanceRank, 0) / half;
  const olderRows = rows.slice(half);
  const olderAverage = olderRows.length
    ? olderRows.reduce((t, r) => t + r.performanceRank, 0) / olderRows.length
    : recentAverage;

  const diff = recentAverage - olderAverage;

  return {
    averagePerformanceRank: Math.round(average),
    matches: matchRows.length,
    wins,
    winRate: matchRows.length
      ? Number((wins / matchRows.length).toFixed(4))
      : 0,
    trend: diff > 150 ? "up" : diff < -150 ? "down" : "flat",
    form: matchRows.map((row) => (row?.result === "win" ? "win" : "loss")),
  };
}

export {
  BENCHMARKS,
  MAX_PERFORMANCE_RANK,
  MIN_PERFORMANCE_RANK,
  ROLE_SOURCE_LABELS,
  WEIGHTS,
  evaluateMatchPlayer,
  evaluateMatches,
  inferRoleFromMatch,
  resolveEvaluationRole,
  resolveHeroTier,
  resolveRoleFit,
  summarizeForm,
};
