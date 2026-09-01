/**
 * Canli mac item tavsiyesi ve takim analizi.
 *
 * NE YAPAR: Ekrandaki her oyuncu satiri icin "simdi ne alsin" onerisi, iki
 * takim icin de kompozisyon karsilastirmasi uretir.
 *
 * VERI ZENGINLIGINE GORE DAVRANIR
 * -------------------------------
 * Canli veri her kurulumda ayni degil ve eksik veriyle kesin konusmak,
 * hic konusmamaktan kotudur. Bu yuzden tavsiye sayisi ELDEKI VERIYE baglidir:
 *
 *   sadece kendi satirimiz (duz GSI)  -> hero planindan 2 oneri
 *   10 hero biliniyor (Overwolf/izleme) -> dusman hero counter'lari acilir
 *   dusman esyalari da goruluyor        -> item-counter kurallari acilir
 *
 * Boylece Overwolf kurulu olan daha net tavsiye alir, olmayan yaniltilmaz.
 *
 * VERI KAYNAGI: `hero-profiles.js` (hero basina core/situational/counter item),
 * `item-counters.js` (dusman esyasina karsi item) ve `item-ids.js` (gorunen ad).
 * Bu modul SAFTIR: ag istegi yapmaz, saat okumaz.
 */

import heroProfiles from "../data/hero-profiles.js";
import itemCounters from "../data/item-counters.js";
import itemIds from "../data/item-ids.js";
import { normalizeHeroKey } from "../heroes/hero-names.js";

/**
 * Veri seviyesine gore tavsiye KOTASI.
 *
 * Neden kota, neden duz bir tavan degil: hero'nun cekirdek plani 6 item
 * tasiyor ve sirayla doldurulsaydi tavan hep oradan dolar, rakibe karsi
 * uretilen counter onerisi hicbir zaman ekrana cikmazdi. O da Overwolf
 * verisinin tum degerini yok ederdi. Her grubun ayrilmis yeri var; artan
 * yerler siranin devamindan tamamlanir.
 */
const ADVICE_QUOTA = {
  /** Yalnizca kendi satirimiz gorunuyor: hero planindan birkac oneri. */
  self: { total: 2, core: 2, counter: 0, situational: 1 },
  /** Iki takimin hero'lari biliniyor: counter item'lar devrede. */
  heroes: { total: 4, core: 2, counter: 2, situational: 1 },
  /** Dusman envanteri de goruluyor: tam kural seti. */
  full: { total: 6, core: 2, counter: 3, situational: 2 },
};

/**
 * Takimda TEK bir kisinin almasi anlamli olan (aura / benzersiz) itemler.
 * Ayni oneri bes kisiye birden verilmemeli.
 */
const TEAM_UNIQUE_ITEMS = new Set([
  "spirit_vessel",
  "mekansm",
  "guardian_greaves",
  "pipe",
  "crimson_guard",
  "vladmir",
  "assault",
  "shivas_guard",
  "lotus_orb",
]);

/** Kompozisyon karsilastirmasinda bakilan ozellikler. */
const TEAM_ATTRIBUTES = [
  { key: "carry", label: "taşıyıcı gücü", source: "tags" },
  { key: "durable", label: "dayanıklılık", source: "tags" },
  { key: "initiator", label: "başlatma", source: "tags" },
  { key: "disabler", label: "kontrol", source: "tags" },
  { key: "support", label: "destek", source: "tags" },
  { key: "escape", label: "kaçış", source: "tags" },
  { key: "pusher", label: "itme", source: "tags" },
  { key: "teamfight", label: "takım savaşı", source: "draft" },
  { key: "saveMechanics", label: "kurtarma", source: "draft" },
  { key: "lateGame", label: "geç oyun", source: "draft" },
];

/** Bir ozellikte "belirgin fark" sayilmasi icin gereken puan araligi. */
const ADVANTAGE_MIN_DIFF = 1.2;
/** Bir ozelligin "eksik" sayilmasi icin ortalamanin altinda kalmasi gereken esik. */
const WEAKNESS_MAX_SCORE = 3.5;

/** Eksik kalan ozellige karsilik takima onerilen itemler. */
const WEAKNESS_ITEMS = {
  saveMechanics: ["force_staff", "glimmer_cape", "lotus_orb"],
  support: ["mekansm", "glimmer_cape", "force_staff"],
  initiator: ["blink", "cyclone"],
  disabler: ["orchid", "sheepstick", "abyssal_blade"],
  durable: ["pipe", "crimson_guard", "assault"],
  escape: ["force_staff", "cyclone", "blink"],
  teamfight: ["black_king_bar", "pipe"],
  lateGame: ["assault", "satanic", "skadi"],
  carry: ["black_king_bar", "manta"],
  pusher: ["assault", "necronomicon"],
};

/** Item gruplarinin arayuzde gorunen adlari. */
const GROUP_LABELS = {
  core: "Çekirdek",
  counter: "Karşı hamle",
  situational: "Duruma göre",
};

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeItemKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^item_/, "");
}

/** key -> gorunen ad. `item-ids.js` id anahtarli oldugu icin bir kez cevrilir. */
const ITEM_LABEL_BY_KEY = new Map(
  Object.values(itemIds || {})
    .filter((row) => row && row.key)
    .map((row) => [normalizeItemKey(row.key), String(row.dname || "")]),
);

/**
 * Item anahtarindan okunabilir ad. Tabloda yoksa anahtardan uretilir; bilinmeyen
 * bir item'i gizlemek yerine ham adiyla gostermek daha dogru.
 *
 * @param {string} key
 * @returns {string}
 */
export function itemDisplayName(key) {
  const normalized = normalizeItemKey(key);
  if (!normalized) {
    return "";
  }
  const known = ITEM_LABEL_BY_KEY.get(normalized);
  if (known) {
    return known;
  }
  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Item ikonunun Dota CDN adresi.
 * @param {string} key
 * @returns {string}
 */
export function itemIconUrl(key) {
  const normalized = normalizeItemKey(key);
  return normalized
    ? `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${normalized}.png`
    : "";
}

/**
 * Bir oyuncu satirinin SAHIP OLDUGU tum itemler (ana + backpack + neutral).
 *
 * @param {Record<string, any>} row
 * @returns {string[]}
 */
export function ownedItems(row) {
  const parts = [
    ...(Array.isArray(row?.items) ? row.items : []),
    ...(Array.isArray(row?.backpack) ? row.backpack : []),
    row?.neutral,
  ];
  return parts.map(normalizeItemKey).filter(Boolean);
}

/**
 * Bir satirin envanteri BILINIYOR mu?
 *
 * Bos dizi ile "veri gelmedi" ayni sey degil: Overwolf satirlarinda item alani
 * hic yoktur, oyunun basinda ise gercekten bos olabilir.
 *
 * @param {Record<string, any>} row
 * @returns {boolean}
 */
function hasInventoryData(row) {
  return Array.isArray(row?.items) || Array.isArray(row?.backpack);
}

/**
 * Elde ne kadar veri var?
 *
 * @param {Array<Record<string, any>>} allies
 * @param {Array<Record<string, any>>} enemies
 * @returns {"self"|"heroes"|"full"}
 */
export function resolveDataLevel(allies, enemies) {
  const enemyHeroes = enemies.filter((row) => normalizeHeroKey(row?.hero));
  if (!enemyHeroes.length) {
    return "self";
  }
  return enemies.some(hasInventoryData) ? "full" : "heroes";
}

/**
 * @param {string} heroKey
 * @returns {Record<string, any>|null}
 */
function profileOf(heroKey) {
  const key = normalizeHeroKey(heroKey);
  return key ? heroProfiles[key] || null : null;
}

/**
 * Tek bir oyuncu icin item tavsiyesi.
 *
 * Kurallar sirayla uygulanir ve her item YALNIZCA BIR KEZ girer; ilk giren
 * gerekcesini korur, cunku ilk kural her zaman daha spesifik olandir.
 *
 * @param {Object} input
 * @param {Record<string, any>} input.player Tavsiye uretilecek satir
 * @param {Array<Record<string, any>>} input.allies Ayni takimdaki satirlar
 * @param {Array<Record<string, any>>} input.enemies Karsi takimdaki satirlar
 * @param {"self"|"heroes"|"full"} input.dataLevel
 * @param {{ add?: string[], remove?: string[] }} [input.override] Elle duzenleme
 * @param {Set<string>} [input.teamTaken] Takimda baskasina zaten onerilenler
 * @returns {Array<{ key: string, name: string, group: string, groupLabel: string, reason: string }>}
 */
export function buildPlayerItemAdvice(input) {
  const player = input?.player || {};
  const hero = normalizeHeroKey(player.hero);
  if (!hero) {
    return [];
  }

  const profile = profileOf(hero);
  const owned = new Set(ownedItems(player));
  const removed = new Set((input.override?.remove || []).map(normalizeItemKey));
  const teamTaken = input.teamTaken || new Set();
  const quota = ADVICE_QUOTA[input.dataLevel] || ADVICE_QUOTA.self;

  /** Aday havuzu; secim en sonda kotaya gore yapilir. */
  /** @type {Map<string, { key: string, group: string, reason: string, order: number }>} */
  const candidates = new Map();

  const push = (rawKey, group, reason) => {
    const key = normalizeItemKey(rawKey);
    if (!key || candidates.has(key) || owned.has(key) || removed.has(key)) {
      return;
    }
    // Aura/benzersiz itemler takimda tek kisiye onerilir.
    if (TEAM_UNIQUE_ITEMS.has(key) && teamTaken.has(key)) {
      return;
    }
    candidates.set(key, { key, group, reason, order: candidates.size });
  };

  // 1. ELLE EKLENENLER — kullanicinin beyani her kuralin onundedir.
  for (const key of input.override?.add || []) {
    push(key, "core", "Elle eklendi.");
  }

  // 2. HERO PLANI — her veri seviyesinde calisir, tek gereken hero bilgisi.
  for (const key of profile?.coreItems || []) {
    push(key, "core", "Hero'nun çekirdek item planında.");
  }

  // 3. DUSMAN HERO COUNTER'I — yalnizca rakip hero'lar biliniyorsa.
  if (input.dataLevel !== "self") {
    for (const enemy of input.enemies || []) {
      const enemyHero = normalizeHeroKey(enemy?.hero);
      const enemyProfile = profileOf(enemyHero);
      if (!enemyProfile) {
        continue;
      }
      for (const key of enemyProfile.counterItems || []) {
        push(
          key,
          "counter",
          `Rakip ${enemyProfile.hero || enemyHero} için karşı item.`,
        );
      }
    }
  }

  // 4. DUSMAN ESYASINA KARSI — yalnizca rakip envanteri goruluyorsa.
  if (input.dataLevel === "full") {
    const enemyOwned = new Set(
      (input.enemies || []).flatMap((row) => ownedItems(row)),
    );
    for (const enemyItem of enemyOwned) {
      for (const key of itemCounters[enemyItem]?.counters || []) {
        push(key, "counter", `Rakipte ${itemDisplayName(enemyItem)} var.`);
      }
    }
  }

  // 5. DURUMA GORE — plan doldurulamadiysa hero'nun esnek itemleri.
  for (const key of profile?.situationalItems || []) {
    push(key, "situational", "Hero'nun duruma göre item planında.");
  }

  return selectByQuota([...candidates.values()], quota).map((row) => ({
    key: row.key,
    group: row.group,
    reason: row.reason,
    name: itemDisplayName(row.key),
    groupLabel: GROUP_LABELS[row.group] || row.group,
  }));
}

/**
 * Adaylardan kotaya gore secim yapar.
 *
 * Once her gruba ayrilmis yer doldurulur (boylece counter onerisi cekirdek
 * planin altinda kaybolmaz), sonra bos kalan yerler ilk siradaki adaylarla
 * tamamlanir. Elle eklenenler ("Elle eklendi.") kotadan bagimsiz olarak en
 * one alinir; kullanicinin beyani kuralin onundedir.
 *
 * @param {Array<{ key: string, group: string, reason: string, order: number }>} candidates
 * @param {{ total: number, core: number, counter: number, situational: number }} quota
 */
function selectByQuota(candidates, quota) {
  const manual = candidates.filter((row) => row.reason === "Elle eklendi.");
  const rest = candidates.filter((row) => row.reason !== "Elle eklendi.");

  /** @type {typeof candidates} */
  const chosen = [...manual];
  const taken = new Set(chosen.map((row) => row.key));

  for (const group of ["core", "counter", "situational"]) {
    const room = Number(quota[group] || 0);
    const fromGroup = rest
      .filter((row) => row.group === group && !taken.has(row.key))
      .slice(0, room);
    for (const row of fromGroup) {
      if (chosen.length >= quota.total) {
        break;
      }
      chosen.push(row);
      taken.add(row.key);
    }
  }

  // Kota doldurulamadiysa (ornek: hero'nun counter adayi yok) kalan yerler
  // sirayla tamamlanir; bos slot birakmanin kimseye faydasi yok.
  for (const row of rest) {
    if (chosen.length >= quota.total) {
      break;
    }
    if (!taken.has(row.key)) {
      chosen.push(row);
      taken.add(row.key);
    }
  }

  return chosen.slice(0, Math.max(quota.total, manual.length));
}

/**
 * Bir takimin ortalama ozellik puanlari (0-10).
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Record<string, number>}
 */
function teamScores(rows) {
  const profiles = rows
    .map((row) => profileOf(row?.hero))
    .filter((row) => row !== null);

  /** @type {Record<string, number>} */
  const scores = {};
  for (const attribute of TEAM_ATTRIBUTES) {
    if (!profiles.length) {
      scores[attribute.key] = 0;
      continue;
    }
    const total = profiles.reduce(
      (sum, profile) =>
        sum + Number(profile?.[attribute.source]?.[attribute.key] || 0),
      0,
    );
    scores[attribute.key] = Number((total / profiles.length).toFixed(2));
  }
  return scores;
}

/**
 * Iki takimin kompozisyon karsilastirmasi ve takim item onerileri.
 *
 * Tavsiye sayisi burada da veri zenginligine baglidir: rakip hero'lar
 * bilinmiyorsa karsilastirma yapilamaz ve yalnizca kendi eksigimiz soylenir.
 *
 * @param {Object} input
 * @param {Array<Record<string, any>>} input.allies
 * @param {Array<Record<string, any>>} input.enemies
 * @param {"self"|"heroes"|"full"} input.dataLevel
 * @returns {{
 *   comparable: boolean,
 *   scores: { ours: Record<string, number>, theirs: Record<string, number> },
 *   advantages: Array<{ key: string, label: string, diff: number }>,
 *   gaps: Array<{ key: string, label: string, score: number }>,
 *   recommendations: Array<{ key: string, name: string, reason: string }>,
 *   note: string
 * }}
 */
export function buildTeamAnalysis(input) {
  const allies = (input?.allies || []).filter((row) =>
    normalizeHeroKey(row?.hero),
  );
  const enemies = (input?.enemies || []).filter((row) =>
    normalizeHeroKey(row?.hero),
  );
  const comparable = enemies.length > 0 && allies.length > 0;

  const ours = teamScores(allies);
  const theirs = teamScores(enemies);

  const advantages = comparable
    ? TEAM_ATTRIBUTES.map((attribute) => ({
        key: attribute.key,
        label: attribute.label,
        diff: Number((ours[attribute.key] - theirs[attribute.key]).toFixed(2)),
      }))
        .filter((row) => row.diff >= ADVANTAGE_MIN_DIFF)
        .sort((a, b) => b.diff - a.diff)
        .slice(0, 3)
    : [];

  const gaps = TEAM_ATTRIBUTES.map((attribute) => ({
    key: attribute.key,
    label: attribute.label,
    score: ours[attribute.key],
  }))
    .filter((row) => row.score > 0 && row.score < WEAKNESS_MAX_SCORE)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  // Takim onerisi eksiklerden turer; ayni item iki kez girmez.
  /** @type {Map<string, { key: string, reason: string }>} */
  const recommendations = new Map();
  const allyOwned = new Set(allies.flatMap((row) => ownedItems(row)));
  for (const gap of gaps) {
    for (const key of WEAKNESS_ITEMS[gap.key] || []) {
      const normalized = normalizeItemKey(key);
      if (recommendations.has(normalized) || allyOwned.has(normalized)) {
        continue;
      }
      recommendations.set(normalized, {
        key: normalized,
        reason: `Takımda ${gap.label} zayıf.`,
      });
    }
  }

  const note = !allies.length
    ? "Hero verisi gelmedi; analiz yapılamıyor."
    : !comparable
      ? "Rakip hero'lar görünmüyor; yalnızca kendi kompozisyonumuz değerlendirildi. Overwolf kuruluysa karşılaştırma da açılır."
      : input.dataLevel === "full"
        ? "Rakip envanteri de görünüyor; öneriler tam veriyle üretildi."
        : "Rakip hero'lar biliniyor, envanterleri bilinmiyor.";

  return {
    comparable,
    scores: { ours, theirs },
    advantages,
    gaps,
    recommendations: [...recommendations.values()]
      .slice(0, 5)
      .map((row) => ({ ...row, name: itemDisplayName(row.key) })),
    note,
  };
}

/**
 * Canli mac icin tum tavsiye paketi.
 *
 * Oyuncu satirlarina `itemAdvice` ekler ve takim analizini uretir. Satirlar
 * DEGISTIRILMEZ; yeni nesneler donulur.
 *
 * @param {Object} input
 * @param {Array<Record<string, any>>} input.radiantPlayers
 * @param {Array<Record<string, any>>} input.direPlayers
 * @param {"radiant"|"dire"} input.myTeam
 * @param {Record<string, { add?: string[], remove?: string[] }>} [input.overrides] hero -> duzenleme
 * @returns {{
 *   dataLevel: "self"|"heroes"|"full",
 *   radiantPlayers: Array<Record<string, any>>,
 *   direPlayers: Array<Record<string, any>>,
 *   teamAnalysis: ReturnType<typeof buildTeamAnalysis>
 * }}
 */
export function buildLiveItemAdvice(input = {}) {
  const radiant = Array.isArray(input.radiantPlayers)
    ? input.radiantPlayers
    : [];
  const dire = Array.isArray(input.direPlayers) ? input.direPlayers : [];
  const myTeam = input.myTeam === "dire" ? "dire" : "radiant";
  const overrides = input.overrides || {};

  const allies = myTeam === "radiant" ? radiant : dire;
  const enemies = myTeam === "radiant" ? dire : radiant;
  const dataLevel = resolveDataLevel(allies, enemies);

  /**
   * Bir takimin satirlarini tavsiyeyle donatir.
   * @param {Array<Record<string, any>>} rows
   * @param {Array<Record<string, any>>} against
   */
  const decorate = (rows, against) => {
    // Aura itemleri takimda tek kisiye onerilsin diye takim capinda takip edilir.
    const teamTaken = new Set();
    return rows.map((row) => {
      const advice = buildPlayerItemAdvice({
        player: row,
        allies: rows,
        enemies: against,
        dataLevel,
        override: overrides[normalizeHeroKey(row?.hero)] || null,
        teamTaken,
      });
      for (const card of advice) {
        if (TEAM_UNIQUE_ITEMS.has(card.key)) {
          teamTaken.add(card.key);
        }
      }
      return { ...row, itemAdvice: advice };
    });
  };

  // Tavsiye HER IKI takim icin de uretilir: rakibin ne alacagini gormek de
  // bilgidir. Rakip icin veri seviyesi dogal olarak daha dusuk kalir.
  const radiantDecorated = decorate(radiant, dire);
  const direDecorated = decorate(dire, radiant);

  return {
    dataLevel,
    radiantPlayers: radiantDecorated,
    direPlayers: direDecorated,
    teamAnalysis: buildTeamAnalysis({ allies, enemies, dataLevel }),
  };
}

export { ADVICE_QUOTA, TEAM_ATTRIBUTES, GROUP_LABELS };
