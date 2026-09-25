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
 * VERI KAYNAGI: `heroes/hero-catalog.js` — uretilmis tohum veri ile
 * kullanicinin "Tavsiyeleri yonet" ekranindaki duzenlemesinin birlesimi. Item
 * counter kurallari `item-counters.js`, gorunen adlar `item-ids.js`. Bu modul
 * SAFTIR: ag istegi yapmaz, saat okumaz.
 */

import itemCosts from "../data/item-costs.js";
import itemCounters from "../data/item-counters.js";
import itemIds from "../data/item-ids.js";
import {
  ROLE_VALUE_KEYS,
  ROLE_VALUE_LABELS,
  heroRecord,
  laneRoleOf,
} from "../heroes/hero-catalog.js";
import { heroDisplayName, normalizeHeroKey } from "../heroes/hero-names.js";
import { isRetiredItem, normalizeItemKey } from "./item-keys.js";
import {
  hasGameTime,
  heldBoots,
  isBootItem,
  isBootUpgradeOf,
  isLateGame,
  isSmallItem,
  nextBuildStep,
  ownedWithComponents,
  sortByCost,
} from "./item-progression.js";
import { predictInventory } from "./predicted-items.js";
import { detectThreats, rowWeights, threatAnswers } from "./threats.js";

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
  /**
   * Iki takimin hero'lari biliniyor: counter item'lar devrede.
   *
   * Counter yeri "full"a yaklasti cunku bu seviye artik daha cok sey biliyor:
   * tehdit cevaplarina ek olarak tahmini rakip envanterinden cikan item
   * kurallari da aday uretiyor (bkz. predicted-items.js). Iki yer kaldiginda
   * tahmine dayanan oneri hicbir zaman ekrana cikmiyordu.
   */
  heroes: { total: 5, core: 2, counter: 3, situational: 1 },
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

/**
 * Takim onerisinde "planinda olan biri var mi" sartindan MUAF itemler.
 *
 * Takim onerisi normalde yalnizca takimdan birinin item planinda gecen
 * itemleri gosterir; yoksa "Pipe al" deyip kimin alacagini soylememis oluruz.
 * Ama dedektor bir build parcasi degil: dust kimsenin planinda yazmaz, rakipte
 * gorunmez hero varsa destek gider alir. Sarti dedektorlere de uygulamak,
 * ozelligin en temel ornegini (rakipte Riki var -> dust) sessizce yutuyordu.
 *
 * Liste DAR tutulur: yalnizca hero plani gerektirmeyen, herkesin alabilecegi
 * itemler. Gercek build itemlerinde sart yerinde kalir.
 */
const ALWAYS_BUYABLE_ITEMS = new Set(["dust", "gem", "essence_distiller"]);

/**
 * Kompozisyon karsilastirmasinda bakilan ozellikler.
 *
 * Anahtarlar hero katalogundaki radar eksenleriyle AYNIDIR: tabloda gorunen
 * yuzde ile analizde kullanilan puan ayni sayidan turemeli, yoksa ekranda
 * "Radiant %65 ani hasar" yazarken analiz baska bir seye dayanir.
 */
const TEAM_ATTRIBUTES = ROLE_VALUE_KEYS.map((key) => ({
  key,
  label: ROLE_VALUE_LABELS[key] || key,
}));

/** Bir ozellikte "belirgin fark" sayilmasi icin gereken yuzde farki. */
const ADVANTAGE_MIN_DIFF = 10;
/** Bir ozelligin "eksik" sayilmasi icin altinda kalmasi gereken yuzde. */
const WEAKNESS_MAX_SCORE = 35;

/** Radarda gosterilen eksenler (alti kose). */
const RADAR_AXES = [
  "carry",
  "burst",
  "catch",
  "durability",
  "escape",
  "initiation",
];

/**
 * Eksik kalan ozellige karsilik takima onerilen itemler.
 *
 * Her item ayrica bir GRUBA girer: cekirdek oyuncularin mi, desteklerin mi
 * alacagi yoksa duruma gore mi bakilacagi. Ekran uc satiri ayri gosteriyor
 * (Core / Support / Duruma Göre) ve grup bilgisi olmadan liste tek bir yigina
 * donerdi.
 */
const WEAKNESS_ITEMS = {
  support: [
    ["mekansm", "support"],
    ["glimmer_cape", "support"],
    ["force_staff", "support"],
    ["pavise", "support"],
  ],
  catch: [
    ["orchid", "core"],
    ["sheepstick", "core"],
    ["abyssal_blade", "core"],
    ["gungir", "situational"],
  ],
  initiation: [
    ["blink", "core"],
    ["cyclone", "support"],
    ["meteor_hammer", "situational"],
  ],
  durability: [
    ["pipe", "support"],
    ["crimson_guard", "support"],
    ["assault", "core"],
    ["heart", "core"],
  ],
  escape: [
    ["force_staff", "support"],
    ["cyclone", "support"],
    ["blink", "core"],
  ],
  burst: [
    ["ethereal_blade", "core"],
    ["veil_of_discord", "situational"],
    ["dagon_5", "situational"],
  ],
  carry: [
    ["black_king_bar", "core"],
    ["manta", "core"],
    ["satanic", "core"],
  ],
  push: [
    ["assault", "core"],
    ["ancient_janggo", "support"],
    ["boots_of_bearing", "support"],
  ],
};

/** Item gruplarinin arayuzde gorunen adlari. */
const GROUP_LABELS = {
  core: "Çekirdek",
  counter: "Karşı hamle",
  situational: "Duruma göre",
  support: "Destek",
};

/**
 * Takim onerisinde bir itemin hangi satirda gorunecegi.
 *
 * Ekran uc satir gosteriyor (Core / Support / Duruma Göre) ve tehdit
 * tablosundaki itemlerin hangi satira ait oldugu oradan anlasilmiyor: Pipe bir
 * destek itemi, Black King Bar cekirdek itemi, ikisi de ayni tehdide cevap
 * veriyor. Tabloda olmayan itemler duruma gore satirina duser.
 */
const ITEM_GROUPS = {
  // Destekler alir.
  pipe: "support",
  mekansm: "support",
  guardian_greaves: "support",
  spirit_vessel: "support",
  essence_distiller: "support",
  glimmer_cape: "support",
  force_staff: "support",
  pavise: "support",
  ancient_janggo: "support",
  boots_of_bearing: "support",
  crimson_guard: "support",
  cyclone: "support",
  dust: "support",
  gem: "support",
  // Cekirdek oyuncular alir.
  black_king_bar: "core",
  silver_edge: "core",
  angels_demise: "core",
  orchid: "core",
  bloodthorn: "core",
  sheepstick: "core",
  sphere: "core",
  abyssal_blade: "core",
  assault: "core",
  manta: "core",
  satanic: "core",
  heart: "core",
  ethereal_blade: "core",
  blink: "core",
  aeon_disk: "core",
  desolator: "core",
  diffusal_blade: "core",
  disperser: "core",
  gungir: "core",
  harpoon: "core",
  nullifier: "core",
  rod_of_atos: "core",
  shivas_guard: "core",
  skadi: "core",
};

/**
 * Item counter tablosu, anahtarlari NORMALIZE edilmis haliyle.
 *
 * Tablo konusma dilindeki yazimlari tasiyor (`linkensphere`, `euls`,
 * `ghost_scepter`); rakip envanteri ise gercek anahtarlarla (`sphere`,
 * `cyclone`, `ghost`) geliyor. Dogrudan bakmak bu uc kuralin hic
 * tetiklenmemesi demekti.
 */
const ITEM_COUNTERS = new Map(
  Object.entries(itemCounters || {}).map(([key, row]) => [
    normalizeItemKey(key),
    (row?.counters || []).map(normalizeItemKey),
  ]),
);

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
 *
 * Anahtar `normalizeItemKey` uzerinden gecer; konusma dilindeki yazimlar
 * (khanda, battle_fury, linkensphere...) burada gercek dosya adina cevrilir.
 * Bunu atlamak ikonun sessizce 404 donmesi demekti.
 *
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
 * Bir oyuncu satirinin SAHIP OLDUGU tum itemler (ana + backpack + neutral + tp).
 *
 * @param {Record<string, any>} row
 * @returns {string[]}
 */
export function ownedItems(row) {
  const parts = [
    ...(Array.isArray(row?.items) ? row.items : []),
    ...(Array.isArray(row?.backpack) ? row.backpack : []),
    row?.neutral,
    row?.neutralEffect,
    row?.tp,
  ];
  return parts.map(normalizeItemKey).filter(Boolean);
}

/**
 * Tavsiye uretirken "elimde var" sayilan itemler.
 *
 * Envanterdekilere ek olarak KULLANILMIS Aghanim's Scepter ve Shard'i da
 * kapsar. Ikisi de alindiginda tuketilir ve hero'nun uzerine islenir; envantere
 * bakan bir kural onlari hic gormez ve scepter'ini coktan kullanmis bir
 * oyuncuya "scepter al" onerisi vermeye devam eder.
 *
 * @param {Record<string, any>} row
 * @returns {Set<string>}
 */
function effectiveOwned(row) {
  const owned = new Set(ownedItems(row));
  if (row?.hasScepter) {
    owned.add("ultimate_scepter");
    owned.add("ultimate_scepter_2");
  }
  if (row?.hasShard) {
    owned.add("aghanims_shard");
  }
  return owned;
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
 * Bir satirin GORULEN + TAHMIN EDILEN itemleri.
 *
 * Envanteri gorunmeyen satirlar icin tahmini envanter (bkz.
 * predicted-items.js) da hesaba katilir. Iki yerde kullaniliyor:
 *
 *   1. Kendi satirinin onerisi : 40. dakikada hala "Phase Boots al" dememek
 *      icin. Elinde ne oldugunu bilmedigimiz bir hero'nun plani hep bastan
 *      okunuyordu.
 *   2. Rakip esya kurallari    : rakip carry'nin BKB alacagi neredeyse
 *      kesinken, Nullifier onerisi yalnizca envanteri gercekten gorebildigimiz
 *      kurulumlarda cikiyordu.
 *
 * TAHMIN GERCEK VERIYI EZMEZ: satirda gercek envanter varsa tahmin uretilmez.
 *
 * @param {Record<string, any>} row
 * @returns {Set<string>}
 */
function assumedOwned(row) {
  const owned = effectiveOwned(row);
  for (const key of row?.predictedItems || []) {
    owned.add(normalizeItemKey(key));
  }
  return owned;
}

/**
 * Oyuncunun BU MACTAKI lane rolu (tek elemanli dizi) ya da bilinmiyorsa
 * hero'nun katalogdaki tum rolleri.
 *
 * Oncelik: Overwolf'un bildirdigi pozisyon, sonra kadrodaki birincil rol
 * (yalnizca hero o rolde oynanabiliyorsa), en son hero'nun tum rolleri.
 * Eskiden hep sonuncusu kullaniliyordu: sup5 oynanan Pudge'un butcesi offlane
 * gibi hesaplaniyor, destege mid/offlane icin tanimli erken itemler
 * oneriliyordu.
 *
 * @param {Record<string, any>} row
 * @param {Record<string, any>|null} record
 * @returns {string[]}
 */
export function playerLaneRoles(row, record) {
  const heroRoles = record?.laneRoles || [];
  const measured = laneRoleOf(row?.position);
  if (measured) {
    return [measured];
  }
  const usual = laneRoleOf(row?.roster?.primaryRole);
  if (usual && heroRoles.includes(usual)) {
    return [usual];
  }
  return [...heroRoles];
}

/** Lane rolleri destek pozisyonu mu? */
const isSupportRoles = (roles) =>
  roles.some((role) => role === "sup4" || role === "sup5");

/**
 * Satirlara tahmini envanter ekler (predictedItems alani).
 *
 * Satirlar DEGISTIRILMEZ; yeni nesneler donulur. Envanteri gorunen satir
 * dokunulmadan gecer — tahmin yalnizca boslugu doldurur.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {number} gameTime Saniye cinsinden oyun saati
 * @param {Record<string, Record<string, any>>} overrides
 * @returns {Array<Record<string, any>>}
 */
function withPredictedItems(rows, gameTime, overrides) {
  return (rows || []).map((row) => {
    if (hasInventoryData(row)) {
      return row;
    }
    const record = recordOf(row?.hero, overrides);
    if (!record) {
      return row;
    }
    return {
      ...row,
      predictedItems: predictInventory({
        record,
        gameTime,
        owned: effectiveOwned(row),
        laneRoles: playerLaneRoles(row, record),
      }),
    };
  });
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
 * Rakibe karsi alinacak itemlerin KANITLARI, tek yerde.
 *
 * Uc kaynak birlikte degerlendirilir:
 *
 *   1. Tehditler (hero-traits)      : "rakipte gorunmez hero var" -> dust
 *   2. Rakibin itemleri              : "rakipte BKB var" -> Nullifier
 *                                      (gorulen ya da tahmin edilen envanter)
 *   3. Rakip hero'nun counterItems'i : katalogdaki "bu hero'ya karsi alinan
 *                                      itemler" listesi; kullanici "Tavsiyeleri
 *                                      yonet" ekraninda duzenleyebiliyor.
 *
 * Ucuncusu eskiden hic okunmuyordu: kullanici listeye item ekliyor, tavsiye
 * degismiyordu. Kisisel oneri ve takim analizi ayni kaniti kullanir; iki
 * panel ayni itemi farkli gerekceyle onermesin diye.
 *
 * AGIRLIK: tehdit agirligi (tasiyan hero sayisi, net worth biliniyorsa guce
 * gore), gorulen item 1, tahmin edilen item 0.5, counterItems'inda item
 * gecen her rakip hero 1 (net worth'e gore olceklenir). Toplam agirlik
 * kotadaki counter sirasini, EN GUCLU tek kanit gerekceyi belirler.
 *
 * @param {Array<Record<string, any>>} enemies
 * @param {Record<string, Record<string, any>>} overrides
 * @returns {{
 *   threats: ReturnType<typeof detectThreats>,
 *   byItem: Map<string, { reason: string, predicted: boolean, weight: number }>
 * }}
 */
function counterEvidence(enemies, overrides) {
  const rows = (enemies || []).filter((row) => normalizeHeroKey(row?.hero));
  const threats = detectThreats(rows, overrides);
  /** @type {Map<string, Array<{ reason: string, predicted: boolean, weight: number }>>} */
  const found = new Map();
  const add = (key, evidence) => {
    if (!key) {
      return;
    }
    if (!found.has(key)) {
      found.set(key, []);
    }
    found.get(key).push(evidence);
  };

  for (const [key, matched] of threatAnswers(threats)) {
    for (const threat of matched) {
      add(key, {
        reason: `${threat.reason}: ${threat.heroes.map(heroDisplayName).join(", ")}.`,
        predicted: false,
        weight: threat.weight,
      });
    }
  }

  const weights = rowWeights(rows);
  /** @type {Map<string, { heroes: string[], weight: number }>} */
  const byHeroList = new Map();
  for (const row of rows) {
    const seen = effectiveOwned(row);
    for (const enemyItem of assumedOwned(row)) {
      const predicted = !seen.has(enemyItem);
      for (const key of ITEM_COUNTERS.get(enemyItem) || []) {
        add(key, {
          reason: predicted
            ? `Rakipte ${itemDisplayName(enemyItem)} bekleniyor.`
            : `Rakipte ${itemDisplayName(enemyItem)} var.`,
          predicted,
          weight: predicted ? 0.5 : 1,
        });
      }
    }
    const hero = normalizeHeroKey(row.hero);
    for (const raw of recordOf(hero, overrides)?.counterItems || []) {
      const key = normalizeItemKey(raw);
      const entry = byHeroList.get(key) || { heroes: [], weight: 0 };
      entry.heroes.push(hero);
      entry.weight += weights.get(row) || 1;
      byHeroList.set(key, entry);
    }
  }
  for (const [key, entry] of byHeroList) {
    add(key, {
      reason: `${entry.heroes.map(heroDisplayName).join(", ")} karşısında etkili.`,
      predicted: false,
      weight: entry.weight,
    });
  }

  /** @type {Map<string, { reason: string, predicted: boolean, weight: number }>} */
  const byItem = new Map();
  for (const [key, list] of found) {
    // Gorulen kanit tahmini EZER; esitlikte ilk eklenen (tehdit) kalir.
    const best = [...list].sort(
      (a, b) =>
        Number(a.predicted) - Number(b.predicted) || b.weight - a.weight,
    )[0];
    byItem.set(key, {
      reason: best.reason,
      predicted: list.every((row) => row.predicted),
      weight:
        Math.round(list.reduce((sum, row) => sum + row.weight, 0) * 100) / 100,
    });
  }
  return { threats, byItem };
}

/**
 * Bir hero'nun BIRLESIK kaydi (tohum veri + kullanicinin duzenlemesi).
 *
 * @param {string} heroKey
 * @param {Record<string, Record<string, any>>} overrides
 * @returns {Record<string, any>|null}
 */
function recordOf(heroKey, overrides = {}) {
  const key = normalizeHeroKey(heroKey);
  return key ? heroRecord(key, overrides?.[key] || null) : null;
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
 * @param {Record<string, Record<string, any>>} [input.heroOverrides] hero -> duzenleme
 * @param {{ add?: string[], remove?: string[] }} [input.override] Tek seferlik ek duzenleme
 * @param {Set<string>} [input.teamTaken] Takimda baskasina zaten onerilenler
 * @param {number} [input.minTotal] Kotanin toplamini en az bu sayiya cikarir
 *   (oyun ici overlay 4 yer gosteriyor; duz GSI kotasi 2'de kaliyor). Grup
 *   paylari degismez, artan yerler siranin devamindan dolar.
 * @param {number|null} [input.gameTime] Saniye cinsinden oyun saati. Verilirse
 *   kademeli oneri (once ara parca), gec oyun filtresi (kucuk item yok) ve
 *   kisisel erken cevaplar (Wand, Raindrop) devreye girer; verilmezse eski
 *   davranis korunur (bkz. item-progression.js).
 * @returns {Array<{ key: string, name: string, group: string, groupLabel: string, reason: string, buildsInto?: string, buildsIntoName?: string }>}
 */
export function buildPlayerItemAdvice(input) {
  const player = input?.player || {};
  const hero = normalizeHeroKey(player.hero);
  if (!hero) {
    return [];
  }

  const overrides = input.heroOverrides || {};
  const record = recordOf(hero, overrides);
  // Tahmini envanter de "elimde var" sayilir: yoksa envanteri gorunmeyen bir
  // satirin onerisi macin basinda donar kalir. Sahip olunan itemlerin
  // PARCALARI da sayilir: Manta'si olana Yasha onerilmez.
  const owned = ownedWithComponents(assumedOwned(player));
  const removed = new Set(
    [...(record?.removedItems || []), ...(input.override?.remove || [])].map(
      normalizeItemKey,
    ),
  );
  // Takimda tek kisinin almasi anlamli itemler: baskasina onerilmis OLANLAR
  // ve takim arkadasinin zaten TASIDIGI (gorulen ya da tahmin edilen)
  // olanlar. Ikincisi eskiden bakilmiyordu; takimda Pipe varken bir baskasina
  // yine Pipe oneriliyordu.
  const teamTaken = new Set(input.teamTaken || []);
  for (const ally of input.allies || []) {
    if (ally === input.player) {
      continue;
    }
    for (const key of ownedWithComponents(assumedOwned(ally))) {
      if (TEAM_UNIQUE_ITEMS.has(key)) {
        teamTaken.add(key);
      }
    }
  }
  const lanes = playerLaneRoles(player, record);
  const baseQuota = ADVICE_QUOTA[input.dataLevel] || ADVICE_QUOTA.self;
  const quota = {
    ...baseQuota,
    total: Math.max(baseQuota.total, Number(input.minTotal) || 0),
  };

  /** Aday havuzu; secim en sonda kotaya gore yapilir. */
  /** @type {Map<string, { key: string, group: string, reason: string, order: number, predicted: boolean, manual: boolean, weight: number }>} */
  const candidates = new Map();

  const gameTime = input.gameTime;
  const late = isLateGame(gameTime);

  // Oyuncunun elindeki bot (gorulen ya da tahmin edilen). Bot varken yalnizca
  // ONUN ust surumu onerilir: Phase alana Arcane/Tranquil, Tranquil alana
  // Arcane onerilmez; Tranquil varsa Boots of Bearing, Arcane varsa Guardian
  // Greaves olabilir. Yalnizca Boots of Speed varsa her bot onun ust surumudur.
  const boots = heldBoots(assumedOwned(player));
  const bootAllowed = (key) =>
    !boots.length || boots.some((boot) => isBootUpgradeOf(key, boot));

  /**
   * Bu item (ya da ara parcasi) onerilemez mi?
   * @param {string} key
   */
  const blocked = (key) =>
    owned.has(key) ||
    removed.has(key) ||
    // Oyundan kaldirilmis item onerilmez. Ornegin Necronomicon 7.29'da
    // kaldirildi; onerilmesi kullaniciyi dukkanda olmayan bir item icin
    // altin biriktirmeye iter ve listenin tamamini supheli hale getirir.
    isRetiredItem(key) ||
    // Aura/benzersiz itemler takimda tek kisiye onerilir.
    (TEAM_UNIQUE_ITEMS.has(key) && teamTaken.has(key)) ||
    (isBootItem(key) && !bootAllowed(key));

  /**
   * @param {string} rawKey
   * @param {string} group
   * @param {string} reason
   * @param {{ predicted?: boolean, manual?: boolean, weight?: number }} [options]
   *   `predicted`: gerekce tahmine dayaniyor; `manual`: kullanicinin elle
   *   ekledigi item — ara parcaya cevrilmez, gec oyun filtresine takilmaz ve
   *   kotadan bagimsiz en one alinir; `weight`: counter onceligi.
   */
  const push = (rawKey, group, reason, options = {}) => {
    const { predicted = false, manual = false, weight = 0 } = options;
    const target = normalizeItemKey(rawKey);
    if (!target || blocked(target)) {
      return;
    }
    // Gec oyunda kucuk item onerilmez: 30. dakikada Raindrop ya da Wand yuva
    // israfi. Dedektorler muaf; gorunmez rakip her dakikada tehdit.
    if (
      late &&
      !manual &&
      !ALWAYS_BUYABLE_ITEMS.has(target) &&
      isSmallItem(target)
    ) {
      return;
    }
    // Kucukten buyuge: Manta yerine once Yasha. Adim yalnizca oyun saati
    // biliniyorsa ve gec oyunda degilsek uretilir.
    const step = manual
      ? { key: target, buildsInto: null }
      : nextBuildStep(target, { have: owned, gameTime, blocked });
    const key = step.key;
    if (candidates.has(key)) {
      return;
    }
    candidates.set(key, {
      key,
      group,
      reason: step.buildsInto
        ? `${itemDisplayName(step.buildsInto)} için ara parça. ${reason}`
        : reason,
      predicted,
      manual,
      weight,
      buildsInto: step.buildsInto,
      order: candidates.size,
    });
  };

  // Rakibe karsi kanitlar (tehditler, rakibin itemleri, rakip hero'nun
  // counterItems listesi; bkz. counterEvidence). Yalnizca rakip hero'lari
  // goruluyorsa anlamli. Rakibin itemlerine bakan kural eskiden yalnizca
  // "full" seviyesinde calisiyordu; Overwolf kurulumunda rakip envanteri HIC
  // gorunmedigi icin tahmini envanter de kullanilir ("bekleniyor").
  const evidence =
    input.dataLevel === "self"
      ? { threats: [], byItem: new Map() }
      : counterEvidence(input.enemies || [], overrides);
  const threats = evidence.threats;

  /**
   * Bir aday, rakip kompozisyonuna cevap veriyor mu?
   *
   * Veriyorsa grubu "counter" olur ve gerekcesi en guclu kaniti anlatir; bu
   * hem kullaniciya NEDEN sorusunu cevaplar hem kotada counter yerinden pay
   * alarak cekirdek planin onune gecmesini saglar.
   *
   * @param {string} key
   * @returns {{ group: string, reason: string, predicted: boolean, weight: number }|null}
   */
  const counterOf = (key) => {
    const found = evidence.byItem.get(key);
    return found ? { group: "counter", ...found } : null;
  };

  /**
   * Hero'nun KENDI listesinden bir itemi havuza koyar.
   * @param {string} rawKey
   * @param {"core"|"situational"} group
   * @param {string} reason
   */
  const pushOwn = (rawKey, group, reason) => {
    const key = normalizeItemKey(rawKey);
    const counter = counterOf(key);
    push(key, counter?.group || group, counter?.reason || reason, {
      predicted: Boolean(counter?.predicted),
      weight: counter?.weight || 0,
    });
  };

  // 1. ELLE EKLENENLER — kullanicinin beyani her kuralin onundedir.
  for (const key of input.override?.add || []) {
    push(key, "core", "Elle eklendi.", { manual: true });
  }

  // 1b. KISISEL ERKEN CEVAPLAR — hero'nun planinda olmasa bile rakibe gore
  //     eklenen ucuz itemler (Wand, Raindrop). Rakip + hero rolu + oyun saati
  //     birlikte bakilir; saat bilinmiyorsa uretilmez (eski davranis).
  if (hasGameTime(gameTime)) {
    // Oyuncunun bu mactaki rolu (bkz. playerLaneRoles); bilinmiyorsa hero'nun
    // tum rolleri.
    const roles = lanes;
    for (const threat of threats) {
      if (!threat.personal) {
        continue;
      }
      if (threat.until !== null && Number(gameTime) >= threat.until) {
        continue;
      }
      const roleFits =
        !threat.roles ||
        threat.roles.some((role) => roles.includes(role)) ||
        (threat.minHeroes > 0 && threat.heroes.length >= threat.minHeroes);
      if (!roleFits) {
        continue;
      }
      const names = threat.heroes.map(heroDisplayName).join(", ");
      for (const key of threat.items) {
        push(key, "counter", `${threat.reason}: ${names}.`, {
          weight: threat.weight,
        });
      }
    }
  }

  // 2. HERO PLANI — her veri seviyesinde calisir, tek gereken hero bilgisi.
  //    Plan pro kullanim SIKLIGINA gore dizili; oyun saati biliniyorsa alim
  //    sirasina (ucuzdan pahaliya) cekilir. Tahmini envanter de plani boyle
  //    okuyor (bkz. sortByCost): 5. dakikada Riki'ye Skadi onerilmez.
  const plan = hasGameTime(gameTime)
    ? sortByCost(record?.requiredItems || [])
    : record?.requiredItems || [];
  for (const key of plan) {
    pushOwn(key, "core", "Hero'nun çekirdek item planında.");
  }

  // 3. DURUMA GORE — hero'nun esnek itemleri. Rakibe cevap verenler yukarida
  //    "counter" olarak isaretlendi ve kotada once gelir.
  for (const key of record?.situationalItems || []) {
    pushOwn(key, "situational", "Hero'nun duruma göre item planında.");
  }

  const pool = singleBoot([...candidates.values()], {
    late,
    planOrder: [
      ...(record?.requiredItems || []),
      ...(record?.situationalItems || []),
    ].map(normalizeItemKey),
  });

  return selectByQuota(pool, quota).map((row) => ({
    key: row.key,
    group: row.group,
    reason: row.reason,
    name: itemDisplayName(row.key),
    groupLabel: GROUP_LABELS[row.group] || row.group,
    // Ara parca onerisiyse hedef item; arayuz "→ Manta" gosterebilsin.
    ...(row.buildsInto
      ? {
          buildsInto: row.buildsInto,
          buildsIntoName: itemDisplayName(row.buildsInto),
        }
      : {}),
  }));
}

/**
 * Adaylar arasinda TEK bir bot birakir.
 *
 * Hero planinda birden fazla bot olabilir (Arcane, Treads, Travel); oyuncuya
 * ayni anda ikisini onermek anlamsiz, bot yuvasi tek. Ara parca onerisi de
 * (Mekansm -> Guardian Greaves) hedefinin botu sayilir.
 *
 * Secim sirasi:
 *   1. Elle eklenen bot (kullanicinin beyani)
 *   2. Rakibe cevap veren bot (counter), kanit agirligi yuksek olan
 *   3. Gec oyunda pahali olan (Travel); erken oyunda hero planinda once gelen
 *      (plan pro kullanim sikligina gore dizili, yani hero'nun en cok alinan
 *      botu)
 *
 * @param {Array<Record<string, any>>} candidates
 * @param {{ late: boolean, planOrder: string[] }} context
 * @returns {Array<Record<string, any>>}
 */
function singleBoot(candidates, { late, planOrder }) {
  const bootOf = (row) =>
    isBootItem(row.key)
      ? row.key
      : row.buildsInto && isBootItem(row.buildsInto)
        ? normalizeItemKey(row.buildsInto)
        : "";
  const boots = candidates.filter((row) => bootOf(row));
  if (boots.length < 2) {
    return candidates;
  }
  const planRank = (row) => {
    const index = planOrder.indexOf(bootOf(row));
    return index < 0 ? Infinity : index;
  };
  const cost = (row) => Number(itemCosts[bootOf(row)] || 0);
  const [keep] = [...boots].sort(
    (a, b) =>
      Number(Boolean(b.manual)) - Number(Boolean(a.manual)) ||
      Number(b.group === "counter") - Number(a.group === "counter") ||
      Number(b.weight || 0) - Number(a.weight || 0) ||
      (late ? cost(b) - cost(a) : 0) ||
      planRank(a) - planRank(b) ||
      a.order - b.order,
  );
  return candidates.filter((row) => !bootOf(row) || row === keep);
}

/**
 * Adaylardan kotaya gore secim yapar.
 *
 * Once her gruba ayrilmis yer doldurulur (boylece counter onerisi cekirdek
 * planin altinda kaybolmaz), sonra bos kalan yerler ilk siradaki adaylarla
 * tamamlanir. Elle eklenenler (`manual`) kotadan bagimsiz olarak en one
 * alinir; kullanicinin beyani kuralin onundedir.
 *
 * @param {Array<{ key: string, group: string, reason: string, order: number, predicted?: boolean, manual?: boolean, weight?: number }>} candidates
 * @param {{ total: number, core: number, counter: number, situational: number }} quota
 */
function selectByQuota(candidates, quota) {
  const manual = candidates.filter((row) => row.manual);
  const rest = candidates.filter((row) => !row.manual);

  /** @type {typeof candidates} */
  const chosen = [...manual];
  const taken = new Set(chosen.map((row) => row.key));

  for (const group of ["core", "counter", "situational"]) {
    const room = Number(quota[group] || 0);
    const fromGroup = rest
      .filter((row) => row.group === group && !taken.has(row.key))
      // Gorulen veriye dayanan oneri, tahmine dayanandan ONCE gelir: "rakipte
      // BKB VAR" ile "BKB BEKLENIYOR" ayni yeri hak etmiyor. Sonra kanit
      // agirligi: uc rakibe cevap veren item, tek rakibe cevap verenin onunde.
      .sort(
        (a, b) =>
          Number(Boolean(a.predicted)) - Number(Boolean(b.predicted)) ||
          Number(b.weight || 0) - Number(a.weight || 0) ||
          a.order - b.order,
      )
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
 * Bir takimin radar yuzdeleri (0-100).
 *
 * Her hero'nun sekiz ekseni 0-100 arasinda; takim degeri BES KISILIK bir takima
 * gore olculur. Bolme neden sabit 5: dort hero gorunen bir takimin "eksigi"
 * gorunmeli. Ortalama alinsaydi tek hero'lu bir takim her eksende %100 cikardi
 * ve draft sirasinda tablo tersine donerdi.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {Record<string, Record<string, any>>} [overrides]
 * @returns {Record<string, number>}
 */
export function teamRoleBars(rows, overrides = {}) {
  const records = (rows || [])
    .map((row) => recordOf(row?.hero, overrides))
    .filter(Boolean);

  /** @type {Record<string, number>} */
  const bars = {};
  for (const attribute of TEAM_ATTRIBUTES) {
    const total = records.reduce(
      (sum, record) => sum + Number(record.roleValues?.[attribute.key] || 0),
      0,
    );
    bars[attribute.key] = Math.max(0, Math.min(100, Math.round(total / 5)));
  }
  return bars;
}

/**
 * Bir takimin diger takima gore BELIRGIN ustunlukleri.
 *
 * @param {Record<string, number>} bars
 * @param {Record<string, number>} against
 * @returns {Array<{ key: string, label: string, diff: number }>}
 */
function advantagesOf(bars, against) {
  return TEAM_ATTRIBUTES.map((attribute) => ({
    key: attribute.key,
    label: attribute.label,
    diff:
      Number(bars[attribute.key] || 0) - Number(against[attribute.key] || 0),
  }))
    .filter((row) => row.diff >= ADVANTAGE_MIN_DIFF)
    .sort((a, b) => b.diff - a.diff);
}

/**
 * Bir takimin eksikleri ve ona ONERILEN itemler.
 *
 * ONERI, MUMKUNSE TAKIMIN KENDI PLANLARIYLA GEREKCELENIR. "Rakipte buyu
 * hasari var, Pipe al" demek tek basina zayif — Pipe'i kim alacak? Planinda
 * Pipe olan biri varsa oneri ona baglanir: planinda Mekansm olan biri varsa
 * Mekansm, Pipe olan varsa Pipe, ikisi de varsa ikisi birden.
 *
 * PLANDA KIMSE YOKSA ONERI DUSMEZ, "DURUMA GORE"YE DUSER. Pipe hicbir
 * hero'nun cekirdek/durumsal listesinde gecmeyebilir ama takim buyu hasarina
 * karsi yine de Pipe almayi dusunmeli — bu, belirli bir hero'nun BUILD'INE
 * baglanamayan, takimin GENEL olarak degerlendirmesi gereken bir oneri.
 * "Core"/"Destek" gostermek belirli bir hero'nun bunu alacagini vaat ederdi;
 * o vaat verilemedigi icin boyle bir oneri her zaman "Duruma göre" sutununa
 * yazilir ve alicisi once destekler, yoksa takimin tamamidir.
 *
 * @param {Record<string, number>} bars Bu takimin radar yuzdeleri
 * @param {Array<Record<string, any>>} rows Bu takimin satirlari
 * @param {Array<Record<string, any>>} against KARSI takimin satirlari
 * @param {Record<string, Record<string, any>>} overrides hero -> duzenleme
 * @param {number|null} [gameTime] Saniye; gec oyunda kucuk item onerilmez
 *   (kisisel oneriyle ayni kural, bkz. item-progression.js)
 * @returns {{
 *   gaps: Array<{ key: string, label: string, score: number }>,
 *   threats: ReturnType<typeof detectThreats>,
 *   items: Array<Record<string, any>>
 * }}
 */
function gapsAndItems(bars, rows, against, overrides, gameTime = null) {
  const gaps = TEAM_ATTRIBUTES.map((attribute) => ({
    key: attribute.key,
    label: attribute.label,
    score: Number(bars[attribute.key] || 0),
  }))
    .filter((row) => row.score < WEAKNESS_MAX_SCORE)
    .sort((a, b) => a.score - b.score);

  // Tahmini envanter de sayilir: kisisel oneri de oyle yapiyor. Aksi halde
  // takim paneli, tahmine gore coktan alinmis bir itemi onermeye devam
  // ederdi ve iki panel celisirdi.
  const owned = ownedWithComponents(
    (rows || []).flatMap((row) => [...assumedOwned(row)]),
  );
  const late = isLateGame(gameTime);

  // item -> onu planinda tasiyan hero'lar.
  /** @type {Map<string, string[]>} */
  const buyers = new Map();
  for (const row of rows || []) {
    const hero = normalizeHeroKey(row?.hero);
    const record = recordOf(hero, overrides);
    if (!record) {
      continue;
    }
    const planned = [
      ...(record.requiredItems || []),
      ...(record.situationalItems || []),
    ];
    for (const rawKey of planned) {
      const key = normalizeItemKey(rawKey);
      if (!key) {
        continue;
      }
      if (!buyers.has(key)) {
        buyers.set(key, []);
      }
      if (!buyers.get(key).includes(hero)) {
        buyers.get(key).push(hero);
      }
    }
  }

  // Belirli bir hero'ya BAGLANAMAYAN onerilerin (dedektorler, plansiz kalan
  // "duruma göre" itemleri) alicisi: once destekler, yoksa takimin tamami.
  // Alici adi olmadan oneri "birisi alsin" demeye duserdi.
  // Destek, oyuncunun BU MACTAKI rolune gore belirlenir (bkz.
  // playerLaneRoles); bilinmiyorsa hero'nun oynanabildigi rollere bakilir.
  const heroesOf = (filter) =>
    (rows || [])
      .filter((row) => normalizeHeroKey(row?.hero))
      .filter((row) => filter(recordOf(row.hero, overrides), row))
      .map((row) => normalizeHeroKey(row.hero));
  const supports = heroesOf((record, row) =>
    isSupportRoles(playerLaneRoles(row, record)),
  );
  const detectionBuyers = supports.length ? supports : heroesOf(Boolean);

  /** @type {Map<string, Record<string, any>>} */
  const items = new Map();

  /**
   * @param {string} rawKey
   * @param {string} group
   * @param {string} reason
   * @param {boolean} [planOnly] Yalnizca planinda tasiyan hero'ya oner;
   *   kimsenin planinda yoksa "Duruma göre"ye dusurme.
   */
  const offer = (rawKey, group, reason, planOnly = false) => {
    const key = normalizeItemKey(rawKey);
    if (!key || items.has(key) || owned.has(key) || isRetiredItem(key)) {
      return;
    }
    if (late && !ALWAYS_BUYABLE_ITEMS.has(key) && isSmallItem(key)) {
      return;
    }

    const planned = buyers.get(key);
    let finalGroup = group;
    let canBuy = planned;

    if (!canBuy?.length) {
      if (planOnly) {
        // Dispel itemleri (Eul's, Manta, Lotus...) hero'nun build'ine
        // siki bagli: Lotus'u planinda olmayan bir carry'ye onermek yanlis
        // bir vaat olurdu. Plan disinda otomatik oneri uretilmez.
        return;
      }
      if (ALWAYS_BUYABLE_ITEMS.has(key)) {
        // Dedektor: hicbir zaman bir hero'nun build'ine baglanmaz, her zaman
        // destege yazilir (bkz. ALWAYS_BUYABLE_ITEMS tanimi).
        canBuy = detectionBuyers;
      } else {
        // Takimda kimsenin planinda olmayan bir item TAMAMEN dusmez: belirli
        // bir hero'ya baglanamadigi icin "Duruma göre"ye duser, alicisi
        // ayni destek-once fallback'i kullanir.
        canBuy = detectionBuyers;
        finalGroup = "situational";
      }
    }
    if (!canBuy?.length) {
      return;
    }

    items.set(key, {
      key,
      group: finalGroup,
      name: itemDisplayName(key),
      groupLabel: GROUP_LABELS[finalGroup] || finalGroup,
      reason,
      buyers: canBuy,
      buyerNames: canBuy.map(heroDisplayName),
    });
  };

  // 1. RAKIP KOMPOZISYONU — asil oneri kaynagi. Tehdit gorulmeden item
  //    onermek, maca bakmadan konusmak olurdu. Kanit kisisel oneriyle ayni
  //    yerden gelir (bkz. counterEvidence).
  const evidence = counterEvidence(against || [], overrides);
  const threats = evidence.threats;
  for (const threat of threats) {
    // Kisisel erken cevaplar (Wand, Raindrop) takim onerisi degil; her
    // oyuncuya kendi satirinda verilir.
    if (threat.personal) {
      continue;
    }
    const names = threat.heroes.map(heroDisplayName).join(", ");
    for (const key of threat.items) {
      offer(
        key,
        ITEM_GROUPS[key] || "situational",
        threat.reason + ": " + names + ".",
        threat.planOnly,
      );
    }
  }

  // 1b. RAKIP HERO'LARA KARSI ITEMLER — rakibin itemleri ve rakip hero'nun
  //     katalogdaki counterItems listesi. Bu itemler hero'nun build'ine
  //     bagli (Nullifier, Lotus...), bu yuzden yalnizca planinda tasiyan
  //     hero'ya onerilir; kimsenin planinda yoksa uretilmez. Guclu kanit once.
  const heroCounters = [...evidence.byItem.entries()]
    .filter(([, row]) => !row.predicted)
    .sort((a, b) => b[1].weight - a[1].weight);
  for (const [key, row] of heroCounters) {
    offer(key, ITEM_GROUPS[key] || "situational", row.reason, true);
  }

  // 2. KENDI EKSIGIMIZ — tehdit yoksa ya da tehdide cevap veren item kimsenin
  //    planinda yoksa panel bos kalmasin.
  for (const gap of gaps) {
    for (const [rawKey, group] of WEAKNESS_ITEMS[gap.key] || []) {
      offer(
        rawKey,
        group,
        "Takımda " + gap.label.toLocaleLowerCase("tr") + " zayıf.",
      );
    }
  }

  return {
    gaps: gaps.slice(0, 4),
    threats,
    items: [...items.values()].slice(0, 15),
  };
}

/**
 * Iki takimin kompozisyon karsilastirmasi ve takim item onerileri.
 *
 * IKI TAKIM ICIN DE SIMETRIK uretilir. Eskiden yalnizca "biz" ve "onlar" vardi;
 * ekranda Radiant ve Dire yan yana duruyor ve hangi tarafta oldugumuza gore
 * sutunlarin yer degistirmesi tabloyu okunamaz hale getiriyordu.
 *
 * Tavsiye sayisi burada da veri zenginligine baglidir: rakip hero'lar
 * bilinmiyorsa karsilastirma yapilamaz ve yalnizca kendi eksigimiz soylenir.
 *
 * @param {Object} input
 * @param {Array<Record<string, any>>} input.allies
 * @param {Array<Record<string, any>>} input.enemies
 * @param {"self"|"heroes"|"full"} input.dataLevel
 * @param {"radiant"|"dire"} [input.myTeam]
 * @param {Record<string, Record<string, any>>} [input.heroOverrides]
 * @param {number|null} [input.gameTime] Saniye; bilinmiyorsa null
 */
export function buildTeamAnalysis(input) {
  const overrides = input?.heroOverrides || {};
  const allies = (input?.allies || []).filter((row) =>
    normalizeHeroKey(row?.hero),
  );
  const enemies = (input?.enemies || []).filter((row) =>
    normalizeHeroKey(row?.hero),
  );
  const comparable = enemies.length > 0 && allies.length > 0;
  const myTeam = input?.myTeam === "dire" ? "dire" : "radiant";

  const ourBars = teamRoleBars(allies, overrides);
  const theirBars = teamRoleBars(enemies, overrides);

  // Her tarafin ONERISI KARSI tarafin kompozisyonundan turer: "biz ne alalim"
  // sorusunun cevabi onlarda ne oldugu.
  const gameTime = hasGameTime(input?.gameTime) ? Number(input.gameTime) : null;
  const ourSide = gapsAndItems(ourBars, allies, enemies, overrides, gameTime);
  const theirSide = gapsAndItems(
    theirBars,
    enemies,
    allies,
    overrides,
    gameTime,
  );

  const advantages = comparable ? advantagesOf(ourBars, theirBars) : [];
  const theirAdvantages = comparable ? advantagesOf(theirBars, ourBars) : [];

  const note = !allies.length
    ? "Hero verisi gelmedi; analiz yapılamıyor."
    : !comparable
      ? "Rakip hero'lar görünmüyor; yalnızca kendi kompozisyonumuz değerlendirildi. Overwolf kuruluysa karşılaştırma da açılır."
      : input.dataLevel === "full"
        ? "Rakip envanteri de görünüyor; öneriler tam veriyle üretildi."
        : "Rakip hero'lar biliniyor, envanterleri bilinmiyor.";

  /** Taraf adiyla eslestirilmis paket; ekran dogrudan bunu ciziyor. */
  const sides = {
    [myTeam]: {
      bars: ourBars,
      advantages,
      gaps: ourSide.gaps,
      // Bu tarafa ONERI URETEN tehditler (yani karsi tarafin tasidiklari).
      threats: ourSide.threats,
      items: ourSide.items,
    },
    [myTeam === "radiant" ? "dire" : "radiant"]: {
      bars: theirBars,
      advantages: theirAdvantages,
      gaps: theirSide.gaps,
      threats: theirSide.threats,
      items: theirSide.items,
    },
  };

  return {
    comparable,
    myTeam,
    radarAxes: RADAR_AXES.map((key) => ({
      key,
      label: ROLE_VALUE_LABELS[key] || key,
    })),
    tableRows: TEAM_ATTRIBUTES,
    radiant: sides.radiant,
    dire: sides.dire,
    // Eski sozlesme korunur: "biz/onlar" bakisini kullanan cagirilar var.
    scores: { ours: ourBars, theirs: theirBars },
    advantages,
    gaps: ourSide.gaps,
    recommendations: ourSide.items.slice(0, 5),
    note,
  };
}

/**
 * Canli mac icin tum tavsiye paketi.
 *
 * Oyuncu satirlarina `itemAdvice` ekler ve takim analizini uretir. Envanteri
 * gorunmeyen satirlara ayrica `predictedItems` yazilir (bkz.
 * predicted-items.js). Satirlar DEGISTIRILMEZ; yeni nesneler donulur.
 *
 * @param {Object} input
 * @param {Array<Record<string, any>>} input.radiantPlayers
 * @param {Array<Record<string, any>>} input.direPlayers
 * @param {"radiant"|"dire"} input.myTeam
 * @param {number} [input.gameTime] Saniye cinsinden oyun saati; tahmini
 *   envanterin olcusu. Verilmezse tahmin uretilmez.
 * @param {Record<string, Record<string, any>>} [input.heroOverrides] hero -> duzenleme
 * @param {Record<string, { add?: string[], remove?: string[] }>} [input.overrides] Eski sekil
 * @param {number} [input.minAdvice] Oyuncu basina en az oneri sayisi (bkz.
 *   buildPlayerItemAdvice `minTotal`)
 */
export function buildLiveItemAdvice(input = {}) {
  const radiantRaw = Array.isArray(input.radiantPlayers)
    ? input.radiantPlayers
    : [];
  const direRaw = Array.isArray(input.direPlayers) ? input.direPlayers : [];
  const myTeam = input.myTeam === "dire" ? "dire" : "radiant";
  const heroOverrides = input.heroOverrides || {};
  const legacy = input.overrides || {};
  const gameTime = Number(input.gameTime) || 0;

  // Veri seviyesi HAM satirlardan olculur: tahmin, envanteri gorunmeyen bir
  // satiri gorunur gibi gostermemeli. Aksi halde "rakip envanteri de
  // goruluyor" yazip tam kural setini acardik.
  const dataLevel = resolveDataLevel(
    myTeam === "radiant" ? radiantRaw : direRaw,
    myTeam === "radiant" ? direRaw : radiantRaw,
  );

  // Envanteri gorunmeyen satirlara tahmini envanter yazilir. Kendi
  // satirimizda ve masaustu uygulamasini calistiran takim arkadaslarimizda
  // gercek envanter var; onlar dokunulmadan gecer.
  const radiant = withPredictedItems(radiantRaw, gameTime, heroOverrides);
  const dire = withPredictedItems(direRaw, gameTime, heroOverrides);

  const allies = myTeam === "radiant" ? radiant : dire;
  const enemies = myTeam === "radiant" ? dire : radiant;

  // Ham deger gecer: "saat bilinmiyor" ile "0. saniye" ayni sey degil.
  const knownTime = hasGameTime(input.gameTime) ? Number(input.gameTime) : null;

  /**
   * Bir takimin satirlarini tavsiyeyle donatir.
   *
   * TAKIMDA TEK KISININ ALMASI ANLAMLI ITEMLER (Pipe, Mekansm, Vessel...)
   * iki gecisle dagitilir. Eskiden satir sirasinda ilk gelen oyuncu itemi
   * kapiyordu: Pipe, durumsal listesinde Pipe olan carry'ye gidiyor, asil
   * alacak destek onu hic gormuyordu. Simdi once herkesin onerisi cikarilir,
   * her tekil item onu isteyenler arasindan ROLU UYAN oyuncuya verilir
   * (destek itemi destege, cekirdek itemi cekirdege), esitlikte itemi
   * listesinde daha one koyan oyuncuya. Ikinci geciste digerleri o itemi
   * almaz, yerine siradaki oneri gelir.
   *
   * @param {Array<Record<string, any>>} rows
   * @param {Array<Record<string, any>>} against
   */
  const decorate = (rows, against) => {
    /**
     * @param {Record<string, any>} row
     * @param {Set<string>} [teamTaken]
     */
    const advise = (row, teamTaken) =>
      buildPlayerItemAdvice({
        player: row,
        allies: rows,
        enemies: against,
        dataLevel,
        heroOverrides,
        override: legacy[normalizeHeroKey(row?.hero)] || null,
        teamTaken,
        minTotal: input.minAdvice,
        gameTime: knownTime,
      });

    // Destek itemi destege, cekirdek itemi cekirdege: uyan 0, uymayan 1.
    const roleMismatch = (row, key) => {
      const group = ITEM_GROUPS[key];
      if (group !== "support" && group !== "core") {
        return 0;
      }
      const support = isSupportRoles(
        playerLaneRoles(row, recordOf(row?.hero, heroOverrides)),
      );
      return (group === "support") === support ? 0 : 1;
    };

    // 1. gecis: tekil item kisitlamasi olmadan herkes ne isterdi?
    const wishes = rows.map((row) => advise(row));
    /** @type {Map<string, number>} tekil item -> alacak satirin sirasi */
    const owner = new Map();
    for (const key of TEAM_UNIQUE_ITEMS) {
      const [best] = wishes
        .map((cards, index) => ({
          index,
          position: cards.findIndex((card) => card.key === key),
        }))
        .filter((row) => row.position >= 0)
        .sort(
          (a, b) =>
            roleMismatch(rows[a.index], key) -
              roleMismatch(rows[b.index], key) ||
            a.position - b.position ||
            a.index - b.index,
        );
      if (best) {
        owner.set(key, best.index);
      }
    }

    // 2. gecis: her satir BASKASINA verilmis tekil itemleri alamaz. Yerine
    // giren yedek tekil item de (running) tek kisiye kalir.
    const running = new Set();
    return rows.map((row, index) => {
      const taken = new Set(running);
      for (const [key, holder] of owner) {
        if (holder !== index) {
          taken.add(key);
        }
      }
      const itemAdvice = advise(row, taken);
      for (const card of itemAdvice) {
        if (TEAM_UNIQUE_ITEMS.has(card.key)) {
          running.add(card.key);
        }
      }
      return { ...row, itemAdvice };
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
    teamAnalysis: buildTeamAnalysis({
      allies,
      enemies,
      dataLevel,
      myTeam,
      heroOverrides,
      gameTime: knownTime,
    }),
  };
}

export {
  ADVICE_QUOTA,
  GROUP_LABELS,
  RADAR_AXES,
  TEAM_ATTRIBUTES,
  WEAKNESS_ITEMS,
  isRetiredItem,
  normalizeItemKey,
};
