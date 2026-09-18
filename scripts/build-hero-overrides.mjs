/**
 * `packages/core/src/data/hero-overrides.js` uretici.
 *
 * NE URETIR: her hero icin TEK bir kayit — radar ekseni degerleri (roleValues),
 * lane rolleri, counter hero/item listeleri ve gerekli/durumsal item listeleri.
 * "Tavsiyeleri yonet" ekrani bu kaydi duzenler, canli mac motoru da tavsiyeyi
 * buradan uretir.
 *
 * NEDEN URETILIYOR, ELLE YAZILMIYOR: hero-profiles.js 99 hero tasiyor, oysa
 * oyunda 127 var. Eksik 28 hero (Lina, Pudge, Shadow Fiend, Rubick...) canli
 * macta hicbir tavsiye almiyordu ve takim analizinde HIC SAYILMIYORDU — yani
 * radar bes kisilik takimi uc kisi uzerinden olcuyordu. Bu uretici bosluklari
 * sirayla asagidaki kaynaklardan doldurur.
 *
 * KAYNAKLAR (oncelik sirasiyla)
 * -----------------------------
 *   1. dotabaff projesi  : hero-overrides.json (roleValues, laneRoles,
 *                          counterHeroes, counterItems) ve ti2026-pro-items.json
 *                          (TI 2026 ana etkinliginden gercek item kullanimi)
 *   2. hero-profiles.js  : bu depodaki mevcut kurgu (tags, counters, coreItems)
 *   3. OpenDota sabitleri: heroes.json `roles` alani — yalnizca ilk ikisi de
 *                          susuyorsa kullanilir; kaba, ama hero'yu analiz
 *                          disinda birakmaktan iyi
 *
 * CALISTIRMA
 *   node scripts/build-hero-overrides.mjs [dotabaff-dizini]
 *
 * Cikti dosyasi depoya COMMITLENIR: uretici disaridaki bir projeye ve aga
 * bagli, ama uygulamanin calismasi bagli olmamali.
 *
 * ELLE YAPILAN DUZENLEME BURAYA YAZILMAZ: bu dosya her calistirmada bastan
 * yazilir. "Tavsiyeleri yonet" ekraninda yapilip kalici kilinmak istenen kayit
 * packages/core/src/data/hero-seed-overrides.js'e girer; o dosya bu uretimin
 * UZERINE biner ve uretici ona dokunmaz.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import heroIds from "../packages/core/src/data/hero-ids.js";
import heroProfiles from "../packages/core/src/data/hero-profiles.js";
import heroRoles from "../packages/core/src/data/hero-roles.js";
import { normalizeHeroKey } from "../packages/core/src/heroes/hero-names.js";
import {
  isRetiredItem,
  normalizeItemKey,
} from "../packages/core/src/live/item-keys.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOTABAFF = process.argv[2] || path.resolve(ROOT, "..", "dotabaff");
const OUTPUT = path.join(
  ROOT,
  "packages",
  "core",
  "src",
  "data",
  "hero-overrides.js",
);
/**
 * Hero'larin OYUNDA GORUNEN adlari.
 *
 * Ayri bir dosya cunku ayri bir is: tavsiye kaydi degisir, ad degismez.
 * Onceden ad ic anahtardan uretiliyordu ve ekranda "Nevermore", "Zuus",
 * "Queenofpain", "Rattletrap" yaziyordu — oyunda o adlarin hicbiri yok.
 */
const NAMES_OUTPUT = path.join(
  ROOT,
  "packages",
  "core",
  "src",
  "data",
  "hero-localized.js",
);

/** OpenDota sabitleri (yalnizca uretim sirasinda cekilir). */
const OPENDOTA_HEROES =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json";
const OPENDOTA_ITEMS =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json";
/** Bir hero'ya son maclarda gercekten alinan itemler (faz faz). */
const OPENDOTA_ITEM_POPULARITY = (heroId) =>
  `https://api.opendota.com/api/heroes/${heroId}/itemPopularity`;

/** Radar eksenleri; sira ekranda gorunen sirayla ayni. */
const ROLE_VALUE_KEYS = [
  "carry",
  "support",
  "burst",
  "catch",
  "escape",
  "durability",
  "initiation",
  "push",
];

/** hero-profiles.js `tags` alanindan radar eksenine karsilik. */
const TAG_TO_ROLE_VALUE = {
  carry: "carry",
  support: "support",
  nuker: "burst",
  disabler: "catch",
  escape: "escape",
  durable: "durability",
  initiator: "initiation",
  pusher: "push",
};

/** OpenDota `roles` etiketinden radar eksenine karsilik. */
const OPENDOTA_ROLE_TO_VALUE = {
  Carry: "carry",
  Support: "support",
  Nuker: "burst",
  Disabler: "catch",
  Escape: "escape",
  Durable: "durability",
  Initiator: "initiation",
  Pusher: "push",
};

/** Bu depoda kullanilan lane rol anahtarlari. */
const LANE_ROLES = ["carry", "mid", "offlane", "sup4", "sup5"];

/** dotabaff'in lane rol adlarini bu depodakine cevirir. */
const LANE_ROLE_ALIASES = {
  support4: "sup4",
  support5: "sup5",
  sup4: "sup4",
  sup5: "sup5",
  safe: "carry",
  support: "sup5",
};

/** Liste basina tavan; ekran bunlari kutu izgarasinda gosteriyor. */
const MAX_COUNTER_HEROES = 10;
const MAX_ITEMS = 8;
/**
 * Bir hero'nun cekirdek planinda en az bu kadar item olmali.
 *
 * Altinda kalan planlar OpenDota alim sirasindan tamamlanir: oyuncu plandaki
 * itemleri aldiginda liste tukeniyor ve tavsiye durumsal itemlere dusuyor.
 */
const MIN_REQUIRED_ITEMS = 4;

/** Gecerli hero anahtarlari (oyunda gercekten var olanlar). */
const KNOWN_HEROES = new Set(Object.values(heroIds).map(String));

/**
 * @param {string} file
 * @returns {any}
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * @param {string} url
 * @param {string} label hata mesajinda gorunecek ad
 * @returns {Promise<any>}
 */
async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(label + " alinamadi: " + response.status);
  }
  return response.json();
}

/**
 * Listeleri sirayla birlestirir: once gelen once kalir, tekrar edenler duser.
 *
 * @param {(value: unknown) => string} normalize
 * @param {number} limit
 * @param {Array<Array<unknown>|undefined>} lists
 * @returns {string[]}
 */
function mergeLists(normalize, limit, ...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const raw of list || []) {
      const key = normalize(raw);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(key);
      if (out.length >= limit) {
        return out;
      }
    }
  }
  return out;
}

/** Yalnizca gercek hero anahtarlarini gecirir. */
function heroKey(value) {
  const key = normalizeHeroKey(value);
  return KNOWN_HEROES.has(key) ? key : "";
}

/** Yalnizca oyunda hala var olan item anahtarlarini gecirir. */
function itemKey(value) {
  const key = normalizeItemKey(value);
  return key && !isRetiredItem(key) ? key : "";
}

/**
 * Lane rollerini bu deponun sozlugune cevirir.
 * @param {Array<unknown>|undefined} list
 * @returns {string[]}
 */
function laneRoleList(list) {
  const out = [];
  for (const raw of list || []) {
    const value = String(raw || "")
      .trim()
      .toLowerCase();
    const key = LANE_ROLE_ALIASES[value] || value;
    if (LANE_ROLES.includes(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

/**
 * 0-100 araligina kirpilmis tam sayi.
 * @param {unknown} value
 * @returns {number}
 */
function clampScore(value) {
  const number = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(100, number));
}

/**
 * dotabaff'in HIC DOKUNULMAMIS hero kaydinda birakti varsayilan kalip.
 *
 * 13 hero bu kalibi tasiyor ve bu "her eksende zayif hero" demek degil,
 * "bu hero hic duzenlenmedi" demek. Oldugu gibi alinsaydi Shadow Fiend, Pudge,
 * Rubick gibi heroler takim radarini asagi cekerdi. Kalip taninip veri yokmus
 * gibi davranilir; siradaki kaynaga (hero-profiles) duselim.
 */
const DOTABAFF_PLACEHOLDER = JSON.stringify({
  carry: 25,
  support: 20,
  burst: 25,
  catch: 25,
  escape: 20,
  durability: 20,
  initiation: 20,
  push: 20,
});

/**
 * dotabaff kaydindan radar degerleri.
 * @param {Record<string, any>|null} override
 * @returns {Record<string, number>|null}
 */
function roleValuesFromDotabaff(override) {
  const source = override?.roleValues;
  if (!source || typeof source !== "object") {
    return null;
  }
  const out = {};
  let filled = 0;
  for (const key of ROLE_VALUE_KEYS) {
    const value = clampScore(source[key]);
    out[key] = value;
    if (value > 0) {
      filled += 1;
    }
  }
  if (!filled || JSON.stringify(out) === DOTABAFF_PLACEHOLDER) {
    return null;
  }
  return out;
}

/**
 * hero-profiles.js `tags` (0-10) degerlerinden radar degerleri (0-100).
 * @param {Record<string, any>|null} profile
 * @returns {Record<string, number>|null}
 */
function roleValuesFromProfile(profile) {
  const tags = profile?.tags;
  if (!tags || typeof tags !== "object") {
    return null;
  }
  const out = {};
  let filled = 0;
  for (const key of ROLE_VALUE_KEYS) {
    out[key] = 0;
  }
  for (const [tag, axis] of Object.entries(TAG_TO_ROLE_VALUE)) {
    const value = Number(tags[tag]);
    if (Number.isFinite(value) && value > 0) {
      out[axis] = clampScore(value * 10);
      filled += 1;
    }
  }
  return filled ? out : null;
}

/**
 * OpenDota rol etiketlerinden KABA radar degerleri.
 *
 * Etiket var/yok bilgisinden fazlasi yok, bu yuzden iki degere dusuyor.
 *
 * @param {string[]} roles
 * @returns {Record<string, number>}
 */
function roleValuesFromOpenDota(roles) {
  const present = new Set(
    (roles || []).map((role) => OPENDOTA_ROLE_TO_VALUE[role]).filter(Boolean),
  );
  const out = {};
  for (const key of ROLE_VALUE_KEYS) {
    out[key] = present.has(key) ? 75 : 25;
  }
  return out;
}

/**
 * OpenDota rol etiketlerinden kaba lane rolu.
 * @param {string[]} roles
 * @returns {string[]}
 */
function laneRolesFromOpenDota(roles) {
  const set = new Set(roles || []);
  if (set.has("Support")) {
    return set.has("Carry") ? ["sup4"] : ["sup5"];
  }
  if (set.has("Carry")) {
    return ["carry"];
  }
  if (set.has("Initiator") || set.has("Durable")) {
    return ["offlane"];
  }
  return ["mid"];
}

/**
 * Bir item TAVSIYE EDILEBILIR mi?
 *
 * OpenDota'nin "bu hero'ya ne alindi" listesi ham satin alma sayimidir; icinde
 * Ogre Axe, Point Booster, Reaver gibi yalnizca BILESEN olan itemler de var.
 * Bunlari onermek "Reaver al" demek olurdu — dogru ama anlamsiz.
 *
 * Kural: bir tarifi olan (yani bir seyden yapilan) her item gercek bir alimdir.
 * Tarifi olmayanlar yalnizca gizli dukkan bileseni degilse ve 2000 altina
 * dusmuyorsa kabul edilir — Blink Dagger boyle geciyor.
 *
 * @param {Record<string, any>|undefined} item dotaconstants kaydi
 * @returns {boolean}
 */
function isRecommendableItem(item) {
  if (!item || item.qual === "consumable") {
    return false;
  }
  if (Array.isArray(item.components) && item.components.length) {
    return true;
  }
  return Number(item.cost || 0) >= 2000 && item.qual !== "secret_shop";
}

/**
 * Ayni listede UST SURUMU bulunan itemleri atar.
 *
 * OpenDota alim sirasi Kaya, Yasha ve Kaya and Sange'yi ucunu birden sayiyor;
 * ucu de listeye girdiginde tavsiye "once parcayi, sonra butunu al" gibi
 * okunuyor ve alti yuvanin yarisi tek bir itemin yolunu anlatiyor. Yalnizca
 * varis noktasi kalir.
 *
 * @param {string[]} keys
 * @param {Record<string, any>} items dotaconstants item tablosu
 * @returns {string[]}
 */
function dropUpgradedComponents(keys, items) {
  const covered = new Set();
  for (const key of keys) {
    for (const part of items[key]?.components || []) {
      covered.add(String(part));
    }
  }
  return keys.filter((key) => !covered.has(key));
}

/**
 * Prettier'in yazacagina yakin, okunabilir bir cikti uretir.
 * @param {any} value
 * @param {number} indent
 * @returns {string}
 */
function stringify(value, indent) {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  if (Array.isArray(value)) {
    if (!value.length) {
      return "[]";
    }
    return (
      "[\n" +
      value.map((row) => inner + JSON.stringify(row)).join(",\n") +
      "\n" +
      pad +
      "]"
    );
  }
  if (value && typeof value === "object") {
    const rows = Object.entries(value).map(
      ([key, row]) =>
        inner + JSON.stringify(key) + ": " + stringify(row, indent + 2),
    );
    return "{\n" + rows.join(",\n") + "\n" + pad + "}";
  }
  return JSON.stringify(value);
}

async function main() {
  const overridesFile = path.join(
    DOTABAFF,
    "src/data/overrides/hero-overrides.json",
  );
  const proFile = path.join(DOTABAFF, "src/data/items/ti2026-pro-items.json");

  if (!fs.existsSync(overridesFile)) {
    throw new Error(
      "dotabaff verisi bulunamadi: " +
        overridesFile +
        "\nKullanim: node scripts/build-hero-overrides.mjs <dotabaff-dizini>",
    );
  }

  const dotabaffOverrides = readJson(overridesFile).heroes || {};
  const proItems = fs.existsSync(proFile) ? readJson(proFile).heroes || {} : {};

  const openDotaHeroes = await fetchJson(
    OPENDOTA_HEROES,
    "OpenDota hero sabitleri",
  );
  const openDotaItems = await fetchJson(
    OPENDOTA_ITEMS,
    "OpenDota item tablosu",
  );
  /** item id -> anahtar; itemPopularity yaniti id ile geliyor. */
  const itemKeyById = new Map(
    Object.entries(openDotaItems).map(([key, row]) => [Number(row?.id), key]),
  );

  const dotabaffByKey = {};
  const proByKey = {};
  const openDotaByKey = {};

  const index = (source, into) => {
    for (const [raw, value] of Object.entries(source || {})) {
      const key = heroKey(raw);
      if (key) {
        into[key] = value;
      }
    }
  };
  index(dotabaffOverrides, dotabaffByKey);
  index(proItems, proByKey);
  for (const hero of Object.values(openDotaHeroes)) {
    const key = heroKey(hero?.name);
    if (key) {
      openDotaByKey[key] = hero;
    }
  }

  const stats = { dotabaff: 0, profile: 0, opendota: 0, itemFallback: 0 };
  /** @type {Record<string, Record<string, any>>} */
  const byKey = {};
  /** hero anahtari -> OpenDota hero id (itemPopularity sorgusu icin). */
  const heroIdByKey = new Map(
    Object.entries(heroIds).map(([id, key]) => [String(key), Number(id)]),
  );

  for (const hero of [...KNOWN_HEROES].sort()) {
    const override = dotabaffByKey[hero] || null;
    const profile = heroProfiles[hero] || null;
    const roles = heroRoles[hero] || null;
    const pro = proByKey[hero] || null;
    const openDotaRoles = openDotaByKey[hero]?.roles || [];

    let roleValues = roleValuesFromDotabaff(override);
    if (roleValues) {
      stats.dotabaff += 1;
    } else {
      roleValues = roleValuesFromProfile(profile);
      if (roleValues) {
        stats.profile += 1;
      } else {
        roleValues = roleValuesFromOpenDota(openDotaRoles);
        stats.opendota += 1;
      }
    }

    const laneRoles = (() => {
      const merged = [
        ...laneRoleList(override?.laneRoles),
        ...laneRoleList(profile?.roles),
        ...laneRoleList(profile?.lane),
        ...laneRoleList(roles?.roles),
        ...laneRoleList(roles?.primaryRole ? [roles.primaryRole] : []),
      ];
      const unique = merged.filter(
        (value, position) => merged.indexOf(value) === position,
      );
      return unique.length ? unique : laneRolesFromOpenDota(openDotaRoles);
    })();

    byKey[hero] = {
      hero,
      laneRoles,
      roleValues,
      counterHeroes: mergeLists(
        heroKey,
        MAX_COUNTER_HEROES,
        override?.counterHeroes,
        profile?.counters,
        roles?.counteredBy,
      ),
      counterItems: mergeLists(
        itemKey,
        MAX_ITEMS,
        override?.counterItems,
        profile?.counterItems,
      ),
      // Pro veri ONCE gelir: TI 2026 ana etkinliginde bu hero'ya gercekten
      // alinan itemler, elle yazilmis bir plandan daha guvenilir.
      requiredItems: mergeLists(
        itemKey,
        MAX_ITEMS,
        pro?.requiredItems,
        profile?.coreItems,
        override?.requiredItems,
      ),
      situationalItems: mergeLists(
        itemKey,
        MAX_ITEMS,
        pro?.situationalItems,
        profile?.situationalItems,
      ),
    };
  }

  // Item plani ZAYIF kalan heroler OpenDota'nin son maclardan cikardigi alim
  // sirasindan tamamlanir.
  //
  // Neden "bos" degil de "zayif": TI 2026 verisi bazi herolar icin tek bir
  // item tasiyor (Lina: yalnizca Boots of Travel). Oyuncu o tek itemi aldigi
  // anda cekirdek plan tukeniyor ve tavsiyenin tamami durumsal listeye
  // dusuyordu — yani mac ilerledikce oneri KOTULESIYORDU.
  for (const [hero, row] of Object.entries(byKey)) {
    if (row.requiredItems.length >= MIN_REQUIRED_ITEMS) {
      continue;
    }
    const heroId = heroIdByKey.get(hero);
    if (!heroId) {
      continue;
    }
    let popularity = null;
    try {
      popularity = await fetchJson(
        OPENDOTA_ITEM_POPULARITY(heroId),
        hero + " item kullanimi",
      );
    } catch (error) {
      console.warn("  " + hero + ": " + String(error?.message || error));
      continue;
    }

    /**
     * Bir fazdan en cok alinan itemler (bilesenler elenmis).
     * @param {string} phase
     */
    const topOf = (phase) =>
      Object.entries(popularity?.[phase] || {})
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([id]) => itemKeyById.get(Number(id)))
        .filter((key) => key && isRecommendableItem(openDotaItems[key]));

    // Eldeki plan ONDE kalir: pro veri ve elle yazilmis kurgu, ham alim
    // sayiminden daha guvenilir.
    const before = row.requiredItems.length;
    row.requiredItems = dropUpgradedComponents(
      mergeLists(
        itemKey,
        MAX_ITEMS,
        row.requiredItems,
        topOf("mid_game_items"),
        topOf("late_game_items"),
      ),
      openDotaItems,
    );
    row.situationalItems = dropUpgradedComponents(
      mergeLists(
        itemKey,
        MAX_ITEMS,
        row.situationalItems,
        topOf("late_game_items"),
        topOf("early_game_items"),
      ),
      openDotaItems,
    ).filter((key) => !row.requiredItems.includes(key));

    if (row.requiredItems.length > before) {
      stats.itemFallback += 1;
    }
  }

  const body = Object.entries(byKey)
    .map(([key, row]) => "  " + JSON.stringify(key) + ": " + stringify(row, 2))
    .join(",\n");

  const file = `/**
 * Hero basina tavsiye ve analiz kaydi (URETILMIS VERI — elle duzenlemeyin).
 *
 * Uretici: scripts/build-hero-overrides.mjs
 * Kaynaklar: dotabaff hero-overrides + TI 2026 pro item kullanimi, bu depodaki
 * hero-profiles.js ve OpenDota hero rol etiketleri.
 *
 * ALANLAR
 *   roleValues       0-100 arasi sekiz eksen; takim radarinin ham girdisi
 *   laneRoles        hero'nun oynandigi pozisyonlar ("Tavsiyeleri yonet"
 *                    ekranindaki gruplama)
 *   counterHeroes    bu hero'yu zorlayan heroler
 *   counterItems     bu hero'ya KARSI alinan itemler
 *   requiredItems    hero'nun cekirdek item plani
 *   situationalItems duruma gore alinan itemler
 *
 * JSON yerine ES modulu olarak tutulur: hem Node (Netlify Functions, Electron)
 * hem tarayici (Vite) tarafinda ek yapilandirma olmadan import edilebilsin diye.
 */
export default {
${body},
};
`;

  fs.writeFileSync(OUTPUT, file, "utf8");
  console.log("yazildi:", path.relative(ROOT, OUTPUT));

  writeNames(openDotaByKey);

  console.log("hero sayisi:", Object.keys(byKey).length);
  console.log(
    "roleValues kaynagi -> dotabaff:",
    stats.dotabaff,
    "| hero-profiles:",
    stats.profile,
    "| opendota:",
    stats.opendota,
  );
  console.log(
    "item plani OpenDota alim sirasindan dolduruldu:",
    stats.itemFallback,
  );
}

/**
 * Hero anahtari -> oyunda gorunen ad tablosunu yazar.
 * @param {Record<string, any>} openDotaByKey
 */
function writeNames(openDotaByKey) {
  const rows = [...KNOWN_HEROES]
    .sort()
    .map((hero) => {
      const name = String(openDotaByKey[hero]?.localized_name || "").trim();
      if (!name) {
        console.warn("  ! " + hero + " icin gorunen ad yok");
        return null;
      }
      return "  " + JSON.stringify(hero) + ": " + JSON.stringify(name) + ",";
    })
    .filter(Boolean)
    .join("\n");

  const header = [
    "/**",
    " * Hero anahtari -> oyunda gorunen ad (URETILMIS VERI — elle duzenlemeyin).",
    " *",
    " * Uretici: scripts/build-hero-overrides.mjs",
    " * Kaynak: OpenDota hero sabitleri (localized_name).",
    " *",
    " * NEDEN GEREKLI: Dota'nin ic anahtarlari gorunen adla ortusmuyor —",
    " * nevermore = Shadow Fiend, zuus = Zeus, queenofpain = Queen of Pain,",
    " * rattletrap = Clockwerk. Ad anahtardan uretildiginde ekranda oyunda hic",
    " * gecmeyen isimler cikiyor ve arama kutusunda hero bulunamiyordu.",
    " */",
    "export default {",
  ].join("\n");

  fs.writeFileSync(NAMES_OUTPUT, header + "\n" + rows + "\n};\n", "utf8");
  console.log("yazildi:", path.relative(ROOT, NAMES_OUTPUT));
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
