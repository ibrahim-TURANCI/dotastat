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

import itemCounters from "../data/item-counters.js";
import itemIds from "../data/item-ids.js";
import {
  ROLE_VALUE_KEYS,
  ROLE_VALUE_LABELS,
  heroRecord,
} from "../heroes/hero-catalog.js";
import { heroDisplayName, normalizeHeroKey } from "../heroes/hero-names.js";
import { isRetiredItem, normalizeItemKey } from "./item-keys.js";
import { predictInventory } from "./predicted-items.js";
import { detectThreats, threatAnswers } from "./threats.js";

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
 * @returns {Array<{ key: string, name: string, group: string, groupLabel: string, reason: string }>}
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
  // satirin onerisi macin basinda donar kalir.
  const owned = assumedOwned(player);
  const removed = new Set(
    [...(record?.removedItems || []), ...(input.override?.remove || [])].map(
      normalizeItemKey,
    ),
  );
  const teamTaken = input.teamTaken || new Set();
  const quota = ADVICE_QUOTA[input.dataLevel] || ADVICE_QUOTA.self;

  /** Aday havuzu; secim en sonda kotaya gore yapilir. */
  /** @type {Map<string, { key: string, group: string, reason: string, order: number }>} */
  const candidates = new Map();

  const push = (rawKey, group, reason, predicted = false) => {
    const key = normalizeItemKey(rawKey);
    if (!key || candidates.has(key) || owned.has(key) || removed.has(key)) {
      return;
    }
    // Oyundan kaldirilmis item onerilmez. Ornegin Necronomicon 7.29'da
    // kaldirildi; onerilmesi kullaniciyi dukkanda olmayan bir item icin
    // altin biriktirmeye iter ve listenin tamamini supheli hale getirir.
    if (isRetiredItem(key)) {
      return;
    }
    // Aura/benzersiz itemler takimda tek kisiye onerilir.
    if (TEAM_UNIQUE_ITEMS.has(key) && teamTaken.has(key)) {
      return;
    }
    candidates.set(key, {
      key,
      group,
      reason,
      predicted,
      order: candidates.size,
    });
  };

  // Rakip kompozisyonunun tasidigi tehditler ve onlara cevap veren itemler.
  // Yalnizca rakip hero'lari goruluyorsa anlamli.
  const threats =
    input.dataLevel === "self"
      ? []
      : detectThreats(input.enemies || [], overrides);
  const answers = threatAnswers(threats);

  // Rakibin ELINDEKI (ya da alacagi) itemlere karsi kurallar.
  //
  // Envanteri gercekten gorulen item "var", tahmin edilen "bekleniyor" der ve
  // secimde geride kalir (bkz. selectByQuota). Kural eskiden yalnizca "full"
  // seviyesinde calisiyordu; Overwolf kurulumunda rakip envanteri HIC
  // gorunmedigi icin de hicbir zaman devreye girmiyordu.
  /** @type {Map<string, { reason: string, predicted: boolean }>} */
  const itemCounterReasons = new Map();
  if (input.dataLevel !== "self") {
    for (const row of input.enemies || []) {
      const seen = effectiveOwned(row);
      for (const enemyItem of assumedOwned(row)) {
        const predicted = !seen.has(enemyItem);
        for (const key of itemCounters[enemyItem]?.counters || []) {
          const normalized = normalizeItemKey(key);
          const current = itemCounterReasons.get(normalized);
          // Gorulen esya, tahmin edileni EZER: ayni cevabi iki rakip
          // tetikliyorsa kesin olani yazmak gerekcenin degerini korur.
          if (current && !(current.predicted && !predicted)) {
            continue;
          }
          itemCounterReasons.set(normalized, {
            predicted,
            reason: predicted
              ? `Rakipte ${itemDisplayName(enemyItem)} bekleniyor.`
              : `Rakipte ${itemDisplayName(enemyItem)} var.`,
          });
        }
      }
    }
  }

  /**
   * Bir aday, rakip kompozisyonuna cevap veriyor mu?
   *
   * Veriyorsa grubu "counter" olur ve gerekcesi tehdidi anlatir; bu hem
   * kullaniciya NEDEN sorusunu cevaplar hem kotada counter yerinden pay alarak
   * cekirdek planin onune gecmesini saglar.
   *
   * @param {string} key
   * @returns {{ group: string, reason: string, predicted?: boolean }|null}
   */
  const counterOf = (key) => {
    const matched = answers.get(key);
    if (matched?.length) {
      const names = matched[0].heroes.map(heroDisplayName).join(", ");
      return { group: "counter", reason: `${matched[0].reason}: ${names}.` };
    }
    const byItem = itemCounterReasons.get(key);
    return byItem
      ? {
          group: "counter",
          reason: byItem.reason,
          predicted: byItem.predicted,
        }
      : null;
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
    push(
      key,
      counter?.group || group,
      counter?.reason || reason,
      Boolean(counter?.predicted),
    );
  };

  // 1. ELLE EKLENENLER — kullanicinin beyani her kuralin onundedir.
  for (const key of input.override?.add || []) {
    push(key, "core", "Elle eklendi.");
  }

  // 2. HERO PLANI — her veri seviyesinde calisir, tek gereken hero bilgisi.
  for (const key of record?.requiredItems || []) {
    pushOwn(key, "core", "Hero'nun çekirdek item planında.");
  }

  // 3. DURUMA GORE — hero'nun esnek itemleri. Rakibe cevap verenler yukarida
  //    "counter" olarak isaretlendi ve kotada once gelir.
  for (const key of record?.situationalItems || []) {
    pushOwn(key, "situational", "Hero'nun duruma göre item planında.");
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
      // Gorulen veriye dayanan oneri, tahmine dayanandan ONCE gelir: kotada
      // yalnizca iki counter yeri var ve "rakipte BKB VAR" ile "BKB
      // BEKLENIYOR" ayni yeri hak etmiyor.
      .sort((a, b) => Number(a.predicted) - Number(b.predicted))
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
 * ONERI HAVUZU TAKIMIN KENDI PLANLARIYLA SINIRLI. "Rakipte buyu hasari var,
 * Pipe al" demek tek basina bir ise yaramiyor — Pipe'i kim alacak? Takimda
 * planinda Pipe olan kimse yoksa oneri havada kalir. Bu yuzden her oneri, o
 * itemi planinda tasiyan hero'larla birlikte doner: planinda Mekansm olan biri
 * varsa Mekansm onerilir, Pipe olan varsa Pipe, ikisi de varsa ikisi birden.
 *
 * @param {Record<string, number>} bars Bu takimin radar yuzdeleri
 * @param {Array<Record<string, any>>} rows Bu takimin satirlari
 * @param {Array<Record<string, any>>} against KARSI takimin satirlari
 * @param {Record<string, Record<string, any>>} overrides hero -> duzenleme
 * @returns {{
 *   gaps: Array<{ key: string, label: string, score: number }>,
 *   threats: ReturnType<typeof detectThreats>,
 *   items: Array<Record<string, any>>
 * }}
 */
function gapsAndItems(bars, rows, against, overrides) {
  const gaps = TEAM_ATTRIBUTES.map((attribute) => ({
    key: attribute.key,
    label: attribute.label,
    score: Number(bars[attribute.key] || 0),
  }))
    .filter((row) => row.score < WEAKNESS_MAX_SCORE)
    .sort((a, b) => a.score - b.score);

  const owned = new Set(
    (rows || []).flatMap((row) => [...effectiveOwned(row)]),
  );

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

  // Plan gerektirmeyen itemleri KIM alacak: once destekler, yoksa takimin
  // tamami. Alici adi olmadan oneri "birisi alsin" demeye duserdi.
  const heroesOf = (filter) =>
    (rows || [])
      .map((row) => normalizeHeroKey(row?.hero))
      .filter((hero) => hero && filter(recordOf(hero, overrides)));
  const supports = heroesOf((record) =>
    record?.laneRoles?.some((role) => role === "sup4" || role === "sup5"),
  );
  const detectionBuyers = supports.length ? supports : heroesOf(Boolean);

  /** @type {Map<string, Record<string, any>>} */
  const items = new Map();

  /**
   * @param {string} rawKey
   * @param {string} group
   * @param {string} reason
   */
  const offer = (rawKey, group, reason) => {
    const key = normalizeItemKey(rawKey);
    if (!key || items.has(key) || owned.has(key) || isRetiredItem(key)) {
      return;
    }
    // Takimdan kimsenin planinda yoksa onerilmez — dedektorler haric, onlar
    // plan gerektirmiyor ve destege yazilir.
    const planned = buyers.get(key);
    const canBuy = planned?.length
      ? planned
      : ALWAYS_BUYABLE_ITEMS.has(key)
        ? detectionBuyers
        : null;
    if (!canBuy?.length) {
      return;
    }
    items.set(key, {
      key,
      group,
      name: itemDisplayName(key),
      groupLabel: GROUP_LABELS[group] || group,
      reason,
      buyers: canBuy,
      buyerNames: canBuy.map(heroDisplayName),
    });
  };

  // 1. RAKIP KOMPOZISYONU — asil oneri kaynagi. Tehdit gorulmeden item
  //    onermek, maca bakmadan konusmak olurdu.
  const threats = detectThreats(against || [], overrides);
  for (const threat of threats) {
    const names = threat.heroes.map(heroDisplayName).join(", ");
    for (const key of threat.items) {
      offer(
        key,
        ITEM_GROUPS[key] || "situational",
        threat.reason + ": " + names + ".",
      );
    }
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
  const ourSide = gapsAndItems(ourBars, allies, enemies, overrides);
  const theirSide = gapsAndItems(theirBars, enemies, allies, overrides);

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
        heroOverrides,
        override: legacy[normalizeHeroKey(row?.hero)] || null,
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
    teamAnalysis: buildTeamAnalysis({
      allies,
      enemies,
      dataLevel,
      myTeam,
      heroOverrides,
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
