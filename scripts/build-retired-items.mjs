/**
 * `packages/core/src/data/retired-items.js` uretici.
 *
 * NE URETIR: oyundan KALDIRILMIS item anahtarlarinin listesi, hangi yamada
 * kaldirildigi bilgisiyle.
 *
 * NEDEN URETILIYOR, ELLE TUTULMUYOR
 * ---------------------------------
 * Elle tutulan bir liste her yamada eskiyor ve eskidigi FARK EDILMIYOR: tavsiye
 * motoru sessizce artik var olmayan bir item onermeye devam ediyor. Eternal
 * Shroud tam olarak boyle kacti — 7.41'de kaldirildi, liste bilmiyordu.
 *
 * ELDEKI TABLOLAR BU SORUYU CEVAPLAYAMIYOR. OpenDota sabitleri de Valve'in
 * `itemlist` beslemesi de kaldirilmis itemleri TASIMAYA DEVAM EDIYOR (eski
 * maclar okunabilsin diye): Necronomicon, Ring of Aquila ve Eternal Shroud
 * ucu de o listelerde duruyor. Yani "listede var" olmasi, oyunda var oldugu
 * anlamina gelmiyor.
 *
 * Valve'in YAMA NOTLARI beslemesi ise kaldirmayi acikca yaziyor
 * ("Item removed from the game"). Kaynak olarak o kullaniliyor: 7.08'den
 * bugune tum yamalar taranir ve kaldirma notu tasiyan her item listeye girer.
 *
 * CALISTIRMA
 *   node scripts/build-retired-items.mjs
 *
 * Cikti dosyasi depoya COMMITLENIR: uretici aga bagli, uygulama degil.
 * Yeni bir yama ciktiginda tekrar calistirmak yeterli.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(
  ROOT,
  "packages",
  "core",
  "src",
  "data",
  "retired-items.js",
);

/** Valve'in yama notlari beslemesi. */
const PATCH_LIST = "https://www.dota2.com/datafeed/patchnoteslist";
const PATCH_NOTES = (version) =>
  `https://www.dota2.com/datafeed/patchnotes?version=${encodeURIComponent(
    version,
  )}&language=english`;

/** item id -> anahtar cevrimi icin. */
const OPENDOTA_ITEMS =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json";

/**
 * Bir notun "bu item artik oyunda yok" dedigini anlayan kaliplar.
 *
 * Besleme tarandiginda item notlarinda yalnizca su uc bicim geciyor:
 *
 *   "Item removed from the game"  7.33 ve sonrasi
 *   "Removed Item"                7.29 — Necronomicon
 *   "Removed"                     7.23 — Tome of Aghanim, Elixir…
 *
 * Kaliplar BILEREK bagli (anchored): "Removed Damage Block ability" gibi notlar
 * da "Removed" ile basliyor ama itemin kendisi duruyor. Bagsiz bir arama
 * calisan itemleri kaldirilmis sayardi ve tavsiye motoru onlari elerdi.
 */
const REMOVAL_PATTERNS = [
  /^item removed from the game$/i,
  /^removed item$/i,
  /^removed$/i,
];

/**
 * Beslemenin GORMEDIGI kaldirmalar.
 *
 * Yama notlari beslemesi 7.08'de basliyor ve o donemin notlari item
 * kaldirmalarini yapisal olarak isaretlemiyor. Asagidakiler oyundan kalkti ama
 * beslemede karsiligi yok. Listeye bir sey eklerken yama notuna bakip
 * dogrulayin — buraya yanlis giren bir item bir daha hic onerilmez.
 */
const EXTRA_RETIRED = {
  iron_talon: "7.07", // 7.37'de neutral olarak dondu, dukkanda yok
  poor_mans_shield: "7.24",
  ring_of_aquila: "7.29",
  // Necronomicon 7.29'da kaldirildi; besleme yalnizca temel surumu
  // isaretliyor, yukseltmeleri ayri item olarak duruyor.
  necronomicon_2: "7.29",
  necronomicon_3: "7.29",
};

/**
 * @param {string} url
 * @param {string} label
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
 * Bir yama notunda kaldirilan itemleri bulur.
 *
 * @param {Record<string, any>} patch Yama notu yaniti
 * @param {Map<number, string>} keyById item id -> anahtar
 * @returns {string[]}
 */
function removedIn(patch, keyById) {
  const found = new Set();
  for (const row of patch?.items || []) {
    const notes = row?.ability_notes || [];
    const removed = notes.some((note) =>
      REMOVAL_PATTERNS.some((pattern) =>
        pattern.test(String(note?.note || "")),
      ),
    );
    if (!removed) {
      continue;
    }
    const key = keyById.get(Number(row.ability_id));
    if (key) {
      found.add(key);
    } else {
      console.warn(
        "  ! id " + row.ability_id + " icin anahtar bulunamadi, atlandi",
      );
    }
  }
  return [...found];
}

async function main() {
  const items = await fetchJson(OPENDOTA_ITEMS, "OpenDota item tablosu");
  const keyById = new Map(
    Object.entries(items).map(([key, row]) => [Number(row?.id), key]),
  );

  const { patches } = await fetchJson(PATCH_LIST, "Yama listesi");
  console.log("taranan yama sayisi:", patches.length);

  /** anahtar -> kaldirildigi yama (ILK gorulen; sonraki notlar tekrar olabilir). */
  const retired = new Map();

  for (const patch of patches) {
    const version = String(patch.patch_number);
    let notes = null;
    try {
      notes = await fetchJson(PATCH_NOTES(version), version + " yama notu");
    } catch (error) {
      console.warn("  ! " + version + ": " + String(error?.message || error));
      continue;
    }

    for (const key of removedIn(notes, keyById)) {
      if (retired.has(key)) {
        continue;
      }
      retired.set(key, version);
      console.log("  " + version + " -> " + key);
    }
  }

  for (const [key, version] of Object.entries(EXTRA_RETIRED)) {
    if (!retired.has(key)) {
      retired.set(key, version);
      console.log("  " + version + " -> " + key + " (elle)");
    }
  }

  // Yamaya gore grupla: cikti dosyasi okunabilir olsun, hangi yamada neyin
  // gittigi tek bakista gorulsun.
  const byPatch = new Map();
  for (const [key, version] of retired) {
    if (!byPatch.has(version)) {
      byPatch.set(version, []);
    }
    byPatch.get(version).push(key);
  }

  const blocks = [...byPatch.entries()]
    .sort((a, b) => compareVersions(a[0], b[0]))
    .map(([version, keys]) => {
      const rows = keys
        .sort()
        .map(
          (key) =>
            "  " +
            JSON.stringify(key) +
            ": " +
            JSON.stringify(version) +
            ", // " +
            (items[key]?.dname || key),
        )
        .join("\n");
      return "  // --- " + version + " ---\n" + rows;
    })
    .join("\n\n");

  const file = `/**
 * Oyundan KALDIRILMIS itemler (URETILMIS VERI — elle duzenlemeyin).
 *
 * Uretici: scripts/build-retired-items.mjs
 * Kaynak: Valve'in yama notlari beslemesi ("Item removed from the game").
 *
 * NEDEN AYRI BIR LISTE GEREKIYOR: hem OpenDota sabitleri hem Valve'in item
 * listesi kaldirilmis itemleri TASIMAYA DEVAM EDIYOR — eski maclar okunabilsin
 * diye. Yani "tabloda var" olmasi oyunda var oldugu anlamina gelmiyor ve
 * tavsiye motorunun bakabilecegi baska bir isaret yok.
 *
 * Anahtar -> kaldirildigi yama.
 *
 * Yeni bir yama ciktiginda ureticiyi tekrar calistirin; liste elle tutulursa
 * eskidigi fark edilmiyor ve motor var olmayan itemleri onermeye devam ediyor.
 */
export default {
${blocks}
};
`;

  fs.writeFileSync(OUTPUT, file, "utf8");
  console.log("\nyazildi:", path.relative(ROOT, OUTPUT));
  console.log("kaldirilmis item sayisi:", retired.size);
}

/**
 * "7.41e" gibi surumleri siralar.
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const parse = (value) => {
    const match = String(value).match(/^(\d+)\.(\d+)([a-z]*)$/);
    return match
      ? [Number(match[1]), Number(match[2]), match[3] || ""]
      : [0, 0, String(value)];
  };
  const left = parse(a);
  const right = parse(b);
  return (
    left[0] - right[0] ||
    left[1] - right[1] ||
    String(left[2]).localeCompare(String(right[2]))
  );
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
