/**
 * Hero havuzunun mac verisinden turetilmesi.
 *
 * Onceden bu dort liste `players.seed.js` icinde ELLE yaziliydi. Artik her
 * kademe farkli bir veri penceresine bakiyor:
 *
 *   imza      -> TUM oyunlar    : cok oynanmis VE kazanma orani yuksek
 *   tercih    -> SON maclar     : son donemde sik alinan
 *   tavsiye   -> oynanmamis/az  : oyuncu tarzina uyan, az oynanip cok kazanilan
 *   zayif     -> TUM oyunlar    : yeterince oynanmis ama kazanamadigi
 *
 * Neden iki ayri pencere: "imza kahraman" kimlik sorusudur, bir aylik formdan
 * etkilenmemelidir; "tercih ettikleri" ise tam tersine su anki meta/ruh halini
 * gostermelidir. Ikisini ayni listeden turetmek her ikisini de bozuyordu.
 *
 * Modul SAFTIR: ag istegi yapmaz, tarih/rastgelelik kullanmaz. Girdi ayni ise
 * cikti ayni olur, boylece test edilebilir.
 */

import heroProfiles from "../data/hero-profiles.js";
import { heroRoleProfile, normalizeHeroKey } from "../heroes/hero-names.js";
import { ROLE_GROUP } from "./player-types.js";

// --- Ayar sabitleri ---------------------------------------------------------

/** Kazanma oranini yumusatan Bayes onceligi (mac sayisi cinsinden). */
const WIN_RATE_PRIOR = 10;

/** Imza kahraman icin gereken en az toplam mac. */
const SIGNATURE_MIN_MATCHES = 10;
/** Listelerde gosterilecek en fazla hero. */
const SECTION_LIMIT = 6;

/** "Az oynanmis" sayilan ust sinir (tavsiye bolumu icin). */
const LOW_SAMPLE_MAX = 9;
/** Az ornekli bir heronun tavsiye edilmesi icin gereken en dusuk oran. */
const LOW_SAMPLE_MIN_WIN_RATE = 0.55;

/** Zayif sayilmak icin gereken en az mac ve ust kazanma orani. */
const WEAK_MIN_MATCHES = 15;
const WEAK_MAX_WIN_RATE = 0.42;

/** Son maclarda tazelik agirligi: bu kadar mac sonra agirlik ~1/e olur. */
const RECENCY_TAU = 18;

/** Imza sayilmak icin gereken en dusuk yumusatilmis kazanma orani. */
const SIGNATURE_MIN_WIN_RATE = 0.48;

/**
 * Tarz vektorunun boyutlari.
 *
 * Yalnizca `tags` kullanmak yetmiyordu: 99 heronun tags degeri 12 farkli
 * arketipe dusuyor, dolayisiyla neredeyse herkes birbirine benziyor. `draft`
 * metrikleri eklenince ayirt edici vektor sayisi 27'ye cikiyor.
 */
const STYLE_TAGS = [
  "carry",
  "support",
  "nuker",
  "durable",
  "initiator",
  "escape",
  "disabler",
  "pusher",
];

const STYLE_DRAFT_DIMS = [
  "teamSynergy",
  "comboPotential",
  "laneSynergy",
  "tempo",
  "teamfight",
  "pushPotential",
  "saveMechanics",
  "catchPotential",
  "scaling",
  "earlyGame",
  "midGame",
  "lateGame",
];

const STYLE_DIMS = [...STYLE_TAGS, ...STYLE_DRAFT_DIMS];

/** hero-profiles.js `roles` degerleri -> RoleKey. */
const HERO_ROLE_TO_ROLE_KEY = {
  carry: "pos1",
  mid: "pos2",
  offlane: "pos3",
  sup4: "pos4",
  sup5: "pos5",
};

/** RoleKey -> hero-roles.js icindeki kaba rol adi (yedek yol). */
const ROLE_KEY_TO_HERO_ROLE = {
  pos1: "carry",
  pos2: "mid",
  pos3: "offlane",
  pos4: "support",
  pos5: "support",
};

// --- Kucuk yardimcilar ------------------------------------------------------

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Ham kazanma orani kucuk orneklerde yaniltir (2 macta %100 gibi). Bu yuzden
 * oran 0.5'e dogru cekilir; mac sayisi arttikca cekme etkisi kaybolur.
 *
 * @param {number} wins
 * @param {number} matches
 * @returns {number} 0..1
 */
export function shrunkWinRate(wins, matches) {
  const games = Math.max(0, Number(matches) || 0);
  const won = clamp(Number(wins) || 0, 0, games);
  return (won + WIN_RATE_PRIOR * 0.5) / (games + WIN_RATE_PRIOR);
}

/**
 * Kazanma oranini 0..1 puana cevirir. %35 ve alti 0, %65 ve ustu 1 sayilir;
 * arasi dogrusaldir. Dota'da anlamli fark bu bantta yasanir.
 *
 * @param {number} winRate 0..1
 */
function winRateScore(winRate) {
  return clamp((winRate - 0.35) / 0.3, 0, 1);
}

/**
 * Mac sayisini 0..1 puana cevirir (logaritmik: 40 ile 80 mac arasindaki fark,
 * 2 ile 12 mac arasindaki fark kadar buyuk sayilmasin).
 *
 * @param {number} matches
 * @param {number} maxMatches Havuzdaki en cok oynanan heronun mac sayisi
 */
function volumeScore(matches, maxMatches) {
  const games = Math.max(0, Number(matches) || 0);
  const ceiling = Math.max(1, Number(maxMatches) || 1);
  return Math.log10(1 + games) / Math.log10(1 + ceiling);
}

/**
 * Bir heronun tarz vektoru (etiketler + draft metrikleri birlesik).
 * @param {string} hero
 * @returns {Record<string, number>|null}
 */
function styleTagsOf(hero) {
  const profile = heroProfiles[normalizeHeroKey(hero)];
  if (!profile) {
    return null;
  }
  /** @type {Record<string, number>} */
  const vector = {};
  for (const tag of STYLE_TAGS) {
    vector[tag] = Number(profile.tags?.[tag] || 0);
  }
  for (const dim of STYLE_DRAFT_DIMS) {
    vector[dim] = Number(profile.draft?.[dim] || 0);
  }
  return vector;
}

/**
 * Tum kahramanlarin boyut ortalamasi.
 *
 * Benzerlik hesabinda vektorler bu ortalamadan CIKARILIR. Ham kosinus tum
 * heroları 0.85+ benzer gosteriyordu (hepsinin "durable"i orta, "tempo"su
 * orta); sapmalara bakinca gercek tarz farki ortaya cikiyor.
 */
const STYLE_MEAN = (() => {
  /** @type {Record<string, number>} */
  const total = {};
  let count = 0;
  for (const hero of Object.keys(heroProfiles)) {
    const vector = styleTagsOf(hero);
    if (!vector) {
      continue;
    }
    count += 1;
    for (const dim of STYLE_DIMS) {
      total[dim] = (total[dim] || 0) + vector[dim];
    }
  }
  /** @type {Record<string, number>} */
  const mean = {};
  for (const dim of STYLE_DIMS) {
    mean[dim] = count ? total[dim] / count : 0;
  }
  return mean;
})();

/**
 * Ortalamadan sapmalar uzerinden kosinus benzerligi.
 *
 * Sonuc -1..1 arasindadir; 0..1 araligina tasinir ki puanlamada isaret
 * sorunu cikmasin (zit tarzli hero 0, ayni tarz 1).
 *
 * @param {Record<string, number>} a
 * @param {Record<string, number>} b
 * @returns {number} 0..1
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const dim of STYLE_DIMS) {
    const x = Number(a[dim] || 0) - STYLE_MEAN[dim];
    const y = Number(b[dim] || 0) - STYLE_MEAN[dim];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) {
    return 0.5;
  }
  const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return clamp((cosine + 1) / 2, 0, 1);
}

/**
 * Oyuncunun "tarz vektoru": en cok oynadigi kahramanlarin etiket ortalamasi.
 * Agirlik mac sayisidir, yani asil oynadigi seyler tarzi belirler.
 *
 * @param {HeroPerformanceRow[]} lifetime
 * @returns {Record<string, number>}
 */
export function buildStyleVector(lifetime) {
  /** @type {Record<string, number>} */
  const vector = {};
  let totalWeight = 0;

  for (const row of lifetime.slice(0, 15)) {
    const tags = styleTagsOf(row.hero);
    if (!tags) {
      continue;
    }
    const weight = Math.max(1, Number(row.matches) || 0);
    totalWeight += weight;
    for (const dim of STYLE_DIMS) {
      vector[dim] = (vector[dim] || 0) + Number(tags[dim] || 0) * weight;
    }
  }

  if (!totalWeight) {
    return {};
  }
  for (const dim of STYLE_DIMS) {
    vector[dim] = Number(((vector[dim] || 0) / totalWeight).toFixed(3));
  }
  return vector;
}

/**
 * Bir heronun oyuncunun oynadigi pozisyonlara uygunlugu.
 * @param {string} hero
 * @param {string[]} roleKeys Oyuncunun pozisyonlari (pos1..pos5)
 * @returns {number} 0..1
 */
function roleFitScore(hero, roleKeys) {
  if (!roleKeys.length) {
    return 0.5;
  }
  const key = normalizeHeroKey(hero);
  const wantedKeys = new Set(roleKeys);

  // Birincil yol: hero-profiles `roles` alani pos1..pos5 ayrimini korur
  // (sup4 ile sup5 ayridir), bu yuzden once ona bakilir.
  const profileRoles = heroProfiles[key]?.roles;
  if (Array.isArray(profileRoles) && profileRoles.length) {
    const mapped = profileRoles
      .map((role) => HERO_ROLE_TO_ROLE_KEY[String(role)])
      .filter(Boolean);
    if (mapped.length) {
      if (mapped.some((role) => wantedKeys.has(role))) {
        // Heronun ASIL rolu oyuncunun asil rolu ise tam puan.
        return mapped[0] === roleKeys[0] ? 1 : 0.8;
      }
      const heroGroups = new Set(mapped.map((role) => ROLE_GROUP[role]));
      const playerGroups = new Set(
        roleKeys.map((role) => ROLE_GROUP[role]).filter(Boolean),
      );
      return [...heroGroups].some((group) => playerGroups.has(group))
        ? 0.4
        : 0.1;
    }
  }

  // Yedek yol: hero-roles.js yalnizca carry/mid/offlane/support ayrimi yapar.
  const profile = heroRoleProfile(hero);
  if (!profile) {
    return 0.5;
  }
  const wantedCoarse = new Set(
    roleKeys.map((role) => ROLE_KEY_TO_HERO_ROLE[role]).filter(Boolean),
  );
  if (wantedCoarse.has(profile.primaryRole)) {
    return 0.9;
  }
  if (profile.roles.some((role) => wantedCoarse.has(role))) {
    return 0.7;
  }
  const heroGroup = profile.primaryRole === "support" ? "support" : "core";
  const playerGroups = new Set(
    roleKeys.map((role) => ROLE_GROUP[role]).filter(Boolean),
  );
  return playerGroups.has(heroGroup) ? 0.4 : 0.1;
}

/**
 * Adayin, oyuncunun en cok oynadigi kahramanlarla combo uyumu.
 *
 * Tarz vektorleri cok sayida heroda birebir ayni cikiyor (99 hero, 27 farkli
 * vektor). O yuzden esitlikleri rastgele/alfabetik degil, gercek veriyle
 * bozariz: hero-profiles `draft.comboWithHeroes` ve hero-roles `synergyWith`
 * listeleri "bu hero senin oynadiklarinla iyi calisir" bilgisini tasir.
 *
 * @param {string} hero
 * @param {string[]} anchorHeroes Oyuncunun en cok oynadigi kahramanlar
 * @returns {number} 0..1
 */
function synergyScore(hero, anchorHeroes) {
  if (!anchorHeroes.length) {
    return 0;
  }
  const key = normalizeHeroKey(hero);
  const anchors = new Set(anchorHeroes.map(normalizeHeroKey));

  const combo = (heroProfiles[key]?.draft?.comboWithHeroes || []).map(
    normalizeHeroKey,
  );
  const synergy = (heroRoleProfile(key)?.synergyWith || []).map(
    normalizeHeroKey,
  );

  let hits = 0;
  for (const other of new Set([...combo, ...synergy])) {
    if (anchors.has(other)) {
      hits += 1;
    }
  }

  // Ters yon: oyuncunun kahramanlarindan biri adayi combo olarak listeliyorsa
  // bu da sayilir (veri her iki yonde simetrik tutulmamis).
  for (const anchor of anchors) {
    const anchorCombo = (
      heroProfiles[anchor]?.draft?.comboWithHeroes || []
    ).map(normalizeHeroKey);
    const anchorSynergy = (heroRoleProfile(anchor)?.synergyWith || []).map(
      normalizeHeroKey,
    );
    if (anchorCombo.includes(key) || anchorSynergy.includes(key)) {
      hits += 1;
    }
  }

  return clamp(hits / 2, 0, 1);
}

// --- Ana kurgu --------------------------------------------------------------

/**
 * @typedef {Object} HeroPoolEntry
 * @property {string} hero
 * @property {number} matches
 * @property {number} wins
 * @property {number} winRate      Ham oran (gosterim icin)
 * @property {number} adjustedWinRate Yumusatilmis oran (siralama icin)
 * @property {number} score        0..1 siralama puani
 * @property {string} reason       Arayuzde gosterilen kisa gerekce
 */

/**
 * @typedef {Object} HeroPerformanceRow
 * @property {string} hero
 * @property {number} matches
 * @property {number} wins
 * @property {number} winRate
 * @property {number} [avgKda]
 */

/**
 * Imza kahramanlar: TUM oyunlarda cok oynanan ve kazanilan.
 *
 * @param {HeroPerformanceRow[]} lifetime
 * @returns {HeroPoolEntry[]}
 */
export function buildSignatureHeroes(lifetime) {
  const rows = lifetime.filter((row) => row.matches >= SIGNATURE_MIN_MATCHES);
  if (!rows.length) {
    return [];
  }
  const maxMatches = rows.reduce((top, row) => Math.max(top, row.matches), 0);

  return (
    rows
      .map((row) => {
        const adjusted = shrunkWinRate(row.wins, row.matches);
        // Hacim ve kazanma neredeyse esit agirlikta: cok oynayip kaybettigi
        // hero imza olmamali, 12 macta %70 yapan da tek basina imza olmamali.
        const score =
          0.55 * volumeScore(row.matches, maxMatches) +
          0.45 * winRateScore(adjusted);
        return {
          hero: row.hero,
          matches: row.matches,
          wins: row.wins,
          winRate: row.winRate,
          adjustedWinRate: Number(adjusted.toFixed(4)),
          score: Number(score.toFixed(4)),
          reason: `${row.matches} maç · %${Math.round(row.winRate * 100)} kazanma`,
        };
      })
      // Cok oynayip kaybettigi hero "imza" degildir; o zayif listesine aittir.
      // Bu esik olmadan az sayida hero oynayan birinde ayni hero iki listede
      // birden gorunuyordu.
      .filter((row) => row.adjustedWinRate >= SIGNATURE_MIN_WIN_RATE)
      .sort((a, b) => b.score - a.score)
      .slice(0, SECTION_LIMIT)
  );
}

/**
 * Tercih ettikleri: SON maclarda sik alinanlar (yeni maclar daha agir).
 *
 * @param {import("./player-types.js").PlayerMatch[]} matches
 * @param {Set<string>} exclude Imza listesine girenler burada tekrarlanmaz
 * @returns {HeroPoolEntry[]}
 */
export function buildPreferredHeroes(matches, exclude = new Set()) {
  const ordered = [...matches].sort(
    (a, b) =>
      new Date(b.startedAt || 0).getTime() -
      new Date(a.startedAt || 0).getTime(),
  );

  /** @type {Map<string, { hero: string, matches: number, wins: number, weight: number }>} */
  const buckets = new Map();

  ordered.forEach((match, index) => {
    const hero = normalizeHeroKey(match?.hero);
    if (!hero) {
      return;
    }
    // Tazelik agirligi: en son mac 1.0, RECENCY_TAU mac oncesi ~0.37.
    const weight = Math.exp(-index / RECENCY_TAU);
    const bucket = buckets.get(hero) || {
      hero,
      matches: 0,
      wins: 0,
      weight: 0,
    };
    bucket.matches += 1;
    bucket.wins += match?.result === "win" ? 1 : 0;
    bucket.weight += weight;
    buckets.set(hero, bucket);
  });

  const rows = [...buckets.values()].filter((row) => !exclude.has(row.hero));
  if (!rows.length) {
    return [];
  }
  const maxWeight = rows.reduce((top, row) => Math.max(top, row.weight), 0);

  return rows
    .map((row) => {
      const winRate = row.matches ? row.wins / row.matches : 0;
      const adjusted = shrunkWinRate(row.wins, row.matches);
      // Burada belirleyici olan SIKLIK; kazanma orani yalnizca esitlik bozar.
      const score =
        0.8 * (maxWeight ? row.weight / maxWeight : 0) +
        0.2 * winRateScore(adjusted);
      return {
        hero: row.hero,
        matches: row.matches,
        wins: row.wins,
        winRate: Number(winRate.toFixed(4)),
        adjustedWinRate: Number(adjusted.toFixed(4)),
        score: Number(score.toFixed(4)),
        reason: `son dönemde ${row.matches} maç`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SECTION_LIMIT);
}

/**
 * Tavsiye edilenler: oyuncunun tarzina uyan, hic/az oynadigi kahramanlar.
 *
 * Iki tur aday vardir:
 *   1. Az oynayip yuksek oran tutturdugu herolar (veri zaten olumlu isaret veriyor)
 *   2. Hic oynamadigi ama etiket profili tarzina cok yakin herolar
 *
 * @param {Object} input
 * @param {HeroPerformanceRow[]} input.lifetime
 * @param {string[]} input.roleKeys Oyuncunun pozisyonlari
 * @param {Set<string>} input.exclude Imza + tercih + zayif listesindekiler
 * @returns {HeroPoolEntry[]}
 */
export function buildRecommendedHeroes(input) {
  const lifetime = Array.isArray(input?.lifetime) ? input.lifetime : [];
  const roleKeys = Array.isArray(input?.roleKeys) ? input.roleKeys : [];
  const exclude = input?.exclude || new Set();

  const styleVector = buildStyleVector(lifetime);
  const hasStyle = Object.keys(styleVector).length > 0;

  // Combo uyumu icin cipa: en cok oynadigi 8 hero.
  const anchorHeroes = lifetime.slice(0, 8).map((row) => row.hero);

  /** @type {Map<string, HeroPerformanceRow>} */
  const played = new Map(
    lifetime.map((row) => [normalizeHeroKey(row.hero), row]),
  );

  /** @type {HeroPoolEntry[]} */
  const candidates = [];

  for (const heroKey of Object.keys(heroProfiles)) {
    const hero = normalizeHeroKey(heroKey);
    if (exclude.has(hero)) {
      continue;
    }

    const history = played.get(hero) || null;
    const matches = Number(history?.matches || 0);
    // Cok oynanmis hero "tavsiye" degildir; o zaten havuzunun icinde.
    if (matches > LOW_SAMPLE_MAX) {
      continue;
    }

    const tags = styleTagsOf(hero);
    const styleFit = hasStyle && tags ? cosineSimilarity(styleVector, tags) : 0;
    const roleFit = roleFitScore(hero, roleKeys);

    // Az ornekli basari: 3 macta %67 yapmis bir hero guclu bir ipucudur,
    // ama tek basina siralamayi ele gecirmesin diye tavan 1'dir.
    const wins = Number(history?.wins || 0);
    const rawWinRate = matches ? wins / matches : 0;
    let lowSampleBonus = 0;
    let reason = "";
    if (matches > 0 && rawWinRate >= LOW_SAMPLE_MIN_WIN_RATE) {
      lowSampleBonus = clamp((rawWinRate - 0.5) * 2, 0, 1);
      reason = `${matches} maçta %${Math.round(rawWinRate * 100)} — az oynanmış`;
    } else if (matches > 0) {
      reason = `${matches} maç oynanmış`;
    } else {
      reason = "hiç oynanmamış";
    }

    const synergy = synergyScore(hero, anchorHeroes);

    // Rol uyumu CARPANDIR, toplanan bir terim degil.
    //
    // Toplamsal oldugunda oyuncunun tarzi rolu eziyordu: dark_seer oynayan
    // birine pos1 secse bile offlane kahramanlar oneriliyordu, cunku tarz
    // benzerligi puanin buyuk kismini tasiyordu. Carpan olunca oynayamayacagi
    // pozisyondaki hero listeye hic cikamaz.
    const score =
      roleFit * (0.55 * styleFit + 0.35 * lowSampleBonus + 0.1 * synergy);
    if (score <= 0) {
      continue;
    }

    const notes = [reason];
    if (hasStyle && styleFit >= 0.6) {
      notes.push("tarzına uygun");
    }
    if (synergy > 0) {
      notes.push("havuzunla uyumlu");
    }

    candidates.push({
      hero,
      matches,
      wins,
      winRate: Number(rawWinRate.toFixed(4)),
      adjustedWinRate: Number(shrunkWinRate(wins, matches).toFixed(4)),
      score: Number(score.toFixed(4)),
      reason: notes.join(" · "),
    });
  }

  return candidates
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.winRate - a.winRate ||
        a.hero.localeCompare(b.hero),
    )
    .slice(0, SECTION_LIMIT);
}

/**
 * Zayif oldugu kahramanlar: yeterince oynanmis ama kazanilamamis.
 *
 * @param {HeroPerformanceRow[]} lifetime
 * @returns {HeroPoolEntry[]}
 */
export function buildWeakHeroes(lifetime) {
  return lifetime
    .filter((row) => row.matches >= WEAK_MIN_MATCHES)
    .map((row) => {
      const adjusted = shrunkWinRate(row.wins, row.matches);
      return {
        hero: row.hero,
        matches: row.matches,
        wins: row.wins,
        winRate: row.winRate,
        adjustedWinRate: Number(adjusted.toFixed(4)),
        score: Number((1 - adjusted).toFixed(4)),
        reason: `${row.matches} maç · %${Math.round(row.winRate * 100)} kazanma`,
      };
    })
    .filter((row) => row.adjustedWinRate < WEAK_MAX_WIN_RATE)
    .sort((a, b) => a.adjustedWinRate - b.adjustedWinRate)
    .slice(0, SECTION_LIMIT);
}

/**
 * Dort kademeyi birlikte uretir.
 *
 * Tum zamanlar verisi yoksa (saglayici limitte, uc cevap vermedi) imza/zayif
 * listeleri son maclardan turetilir; bu durumda `derivedFrom` alani
 * "recent" olur ve arayuz bunu belirtebilir.
 *
 * @param {Object} input
 * @param {HeroPerformanceRow[]} [input.lifetime] Tum zamanlarin hero istatistigi
 * @param {import("./player-types.js").PlayerMatch[]} [input.matches] Son maclar
 * @param {import("./player-types.js").Player|null} [input.player]
 */
export function buildHeroPool(input) {
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const player = input?.player || null;

  const lifetimeInput = Array.isArray(input?.lifetime) ? input.lifetime : [];
  const hasLifetime = lifetimeInput.length > 0;

  // Tum zamanlar verisi yoksa son maclardan bir vekil uretilir. Ayni sekli
  // tasidigi icin asagidaki hesaplar degismez, yalnizca pencere daralir.
  const lifetime = hasLifetime
    ? lifetimeInput
        .map((row) => ({
          hero: normalizeHeroKey(row.hero),
          matches: Number(row.matches) || 0,
          wins: Number(row.wins) || 0,
          winRate: Number(row.winRate) || 0,
          avgKda: Number(row.avgKda) || 0,
        }))
        .filter((row) => row.hero && row.matches > 0)
        .sort((a, b) => b.matches - a.matches)
    : summarizeMatchesAsLifetime(matches);

  const roleKeys = [
    player?.dotaProfile?.primaryRole,
    ...(player?.dotaProfile?.secondaryRoles || []),
  ].filter(Boolean);

  const signature = buildSignatureHeroes(lifetime);
  const signatureKeys = new Set(signature.map((row) => row.hero));

  const preferred = buildPreferredHeroes(matches, signatureKeys);
  const weak = buildWeakHeroes(lifetime);

  const exclude = new Set([
    ...signatureKeys,
    ...preferred.map((row) => row.hero),
    ...weak.map((row) => row.hero),
  ]);
  const recommended = buildRecommendedHeroes({
    lifetime,
    roleKeys,
    exclude,
  });

  return {
    signature,
    preferred,
    recommended,
    weak,
    styleVector: buildStyleVector(lifetime),
    derivedFrom: hasLifetime ? "lifetime" : "recent",
    lifetimeMatches: lifetime.reduce((total, row) => total + row.matches, 0),
    recentMatches: matches.length,
  };
}

/**
 * Tum zamanlar ucu kullanilamadiginda son maclardan vekil ozet cikarir.
 * @param {import("./player-types.js").PlayerMatch[]} matches
 * @returns {HeroPerformanceRow[]}
 */
function summarizeMatchesAsLifetime(matches) {
  /** @type {Map<string, HeroPerformanceRow>} */
  const buckets = new Map();
  for (const match of matches) {
    const hero = normalizeHeroKey(match?.hero);
    if (!hero) {
      continue;
    }
    const bucket = buckets.get(hero) || {
      hero,
      matches: 0,
      wins: 0,
      winRate: 0,
      avgKda: 0,
    };
    bucket.matches += 1;
    bucket.wins += match?.result === "win" ? 1 : 0;
    bucket.winRate = Number((bucket.wins / bucket.matches).toFixed(4));
    buckets.set(hero, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.matches - a.matches);
}

export {
  LOW_SAMPLE_MAX,
  SECTION_LIMIT,
  SIGNATURE_MIN_MATCHES,
  WEAK_MIN_MATCHES,
};
