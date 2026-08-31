/**
 * MMR gecmisi ve mac eslestirmesi.
 *
 * NEDEN AYRI BIR MODUL: MMR degerini hicbir genel API vermiyor — ne Dota'nin
 * GSI'si, ne OpenDota, ne Stratz. Deger yalnizca oyun istemcisinde duruyor.
 * Masaustu tarafi onu disaridan okuyup buraya `{ at, mmr }` ciftleri olarak
 * veriyor; bu modul ham degerleri MACLARA baglar.
 *
 * Eslestirme zaman uzerinden yapilir: MMR mac bittikten kisa sure sonra
 * guncellenir, dolayisiyla bir degisim, kendisinden ONCE biten EN YAKIN maca
 * aittir. Mac bitis zamani `startedAt + durationSeconds` ile hesaplanir;
 * ayrica bir kayit tutmaya gerek yoktur.
 *
 * Modul SAFTIR: dosya okumaz, saat okumaz (pencere disi karar icin bile),
 * yalnizca verilen girdiye bakar. Bu sayede test edilebilir.
 */

/**
 * Bir MMR degisiminin maca ait sayilmasi icin mac bitisinden sonra gecebilecek
 * en uzun sure.
 *
 * Kaynak degeri mac biter bitmez YAZMIYOR; bir sonraki firsatta (uygulama one
 * geldiginde, siradaki mac baslarken) okuyor. Gercek loglarda olculen gecikme
 * 2 ile 66 dakika arasinda degisti. Bu yuzden pencere genis tutuldu.
 *
 * Ust sinir "gunler once oynanmis bir maca yanlislikla yazma"yi engellemek
 * icin var: ayni loglarda 12 saat ve 3 gunluk bosluklar da vardi (uygulama
 * kapaliyken oynanmis maclar), onlarin hangi maca ait oldugu bilinemez.
 */
export const MMR_MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Okumanin mac bitisinden ONCE gelmesine izin verilen pay.
 *
 * Mac bitisi `startedAt + durationSeconds` ile hesaplaniyor ve bu, gercek
 * bitisten birkac dakika SONRAYA dusuyor (olculdu: 1-3 dakika). Kaynak ise
 * MMR'i mac biter bitmez okuyor. Pay olmadan her okuma bir onceki maca
 * kayiyordu — kayip bir mac "+32" gorunuyordu.
 */
export const MMR_MATCH_LEAD_MS = 15 * 60 * 1000;

/**
 * Bir yildizin MMR genisligi.
 *
 * Dota'da her madalya 5 yildizdir ve yildizlar esit araliklidir. Deger
 * gercek veriyle dogrulandi: MMR 3620 -> Legend 4 (rank_tier 54) ve bir
 * sonraki yildiza 76 MMR — oyun ici gostergeyle birebir ayni.
 */
export const MMR_PER_STAR = 154;

/** Madalya adlari (rank_tier'in ilk hanesi ile ayni sira). */
const MEDAL_NAMES = [
  "",
  "Herald",
  "Guardian",
  "Crusader",
  "Archon",
  "Legend",
  "Ancient",
  "Divine",
  "Immortal",
];

/** Immortal'da yildiz yoktur; ustunde esik de yoktur. */
const IMMORTAL_INDEX = 35;

/**
 * MMR degerinden madalya, yildiz ve bir sonraki yildiza kalan mesafe.
 *
 * @param {number} mmr
 * @returns {{
 *   mmr: number, medal: number, stars: number, label: string,
 *   floor: number, next: number, remaining: number, isTop: boolean
 * }|null}
 */
export function rankProgress(mmr) {
  const value = Number(mmr) || 0;
  if (value <= 0) {
    return null;
  }

  const index = Math.floor(value / MMR_PER_STAR);
  if (index >= IMMORTAL_INDEX) {
    // Immortal'in ustunde yildiz yok; ilerleme cubugu anlamsiz olur.
    return {
      mmr: value,
      medal: 8,
      stars: 0,
      label: "Immortal",
      floor: IMMORTAL_INDEX * MMR_PER_STAR,
      next: 0,
      remaining: 0,
      isTop: true,
    };
  }

  const medal = Math.floor(index / 5) + 1;
  const stars = (index % 5) + 1;
  const next = (index + 1) * MMR_PER_STAR;

  return {
    mmr: value,
    medal,
    stars,
    label: (MEDAL_NAMES[medal] || "") + " " + stars,
    floor: index * MMR_PER_STAR,
    next,
    remaining: next - value,
    isTop: false,
  };
}

/**
 * Madalya + yildizdan YAKLASIK MMR.
 *
 * NEDEN GEREKLI: MMR degerini yalnizca masaustu uygulamasini kurmus oyuncular
 * icin okuyabiliyoruz (bkz. services/mmr-watcher.js). Kadronun geri kalaninda
 * elimizde sadece saglayicinin verdigi madalya var. Madalya bandinin ORTASI
 * alinarak tahmini bir deger uretilir; boylece ayni ekranda herkes ayni
 * olcekte gosterilir.
 *
 * Deger `rankProgress` ile TUTARLIDIR: uretilen MMR geri verildiginde ayni
 * madalya ve yildiz cikar (band ortasi secildigi icin yuvarlama kaymasi yok).
 * Ornek: Legend 4 -> 3619 -> rankProgress -> Legend 4, kalan 77.
 *
 * Bu bir TAHMINDIR; arayuzde her zaman "yaklasik" olarak isaretlenmelidir.
 *
 * @param {{ medal?: number, stars?: number }|null} rank
 * @returns {number} bilinmiyorsa 0
 */
export function approximateMmrFromRank(rank) {
  const medal = Number(rank?.medal) || 0;
  if (medal < 1) {
    return 0;
  }
  if (medal >= 8) {
    // Immortal'da yildiz yok; tabani veririz, ustu bilinemez.
    return IMMORTAL_INDEX * MMR_PER_STAR;
  }
  // Yildiz gelmediginde (bazi kayitlarda 0 yaziyor) madalyanin ilk yildizi
  // varsayilir; band ortasi yine de madalyanin icinde kalir.
  const stars = Math.min(5, Math.max(1, Number(rank?.stars) || 1));
  const index = (medal - 1) * 5 + (stars - 1);
  return Math.round(index * MMR_PER_STAR + MMR_PER_STAR / 2);
}

/**
 * Madalyanin yaninda gosterilecek MMR ilerlemesi.
 *
 * OLCULEN deger her zaman kazanir; yoksa madalyadan tahmin uretilir. Iki
 * durum `approximate` bayragiyla ayrilir — arayuz tahmini olani "~" ve
 * "yaklasik" etiketiyle gosterir, aksi halde kurulum yapmis oyuncularin
 * gercek degeriyle karisir.
 *
 * @param {{ samples?: MmrSample[], rank?: { medal?: number, stars?: number }|null }} input
 * @returns {(ReturnType<typeof rankProgress> & { approximate: boolean })|null}
 */
export function resolveRankProgress(input) {
  const measured = latestMmr(input?.samples || []);
  if (measured > 0) {
    const progress = rankProgress(measured);
    return progress ? { ...progress, approximate: false } : null;
  }

  const estimated = approximateMmrFromRank(input?.rank || null);
  if (!estimated) {
    return null;
  }
  const progress = rankProgress(estimated);
  return progress ? { ...progress, approximate: true } : null;
}

/**
 * Gecmisteki EN SON okunan MMR.
 *
 * @param {MmrSample[]} samples
 * @returns {number} bilinmiyorsa 0
 */
export function latestMmr(samples) {
  const rows = (Array.isArray(samples) ? samples : [])
    .map((row) => ({
      mmr: Number(row?.mmr) || 0,
      time: new Date(row?.at || 0).getTime(),
    }))
    .filter((row) => row.mmr > 0 && Number.isFinite(row.time) && row.time > 0)
    .sort((a, b) => b.time - a.time);
  return rows[0]?.mmr || 0;
}

/**
 * @typedef {Object} MmrSample
 * @property {string} at   ISO tarih
 * @property {number} mmr
 */

/**
 * @typedef {Object} MmrChange
 * @property {string} at     Degisimin okundugu an (ISO)
 * @property {number} mmr    Yeni deger
 * @property {number} delta  Onceki degere gore fark
 */

/**
 * Ham okumalari sirala, tekrarlari at, degisimleri cikar.
 *
 * Masaustu tarafi ayni degeri defalarca okuyabilir (DotaPlus her birkac
 * saniyede bir yaziyor); burada yalnizca DEGISIM anlari kalir.
 *
 * @param {MmrSample[]} samples
 * @returns {MmrChange[]}
 */
export function toMmrChanges(samples) {
  const rows = (Array.isArray(samples) ? samples : [])
    .map((row) => ({
      at: String(row?.at || ""),
      mmr: Number(row?.mmr) || 0,
      time: new Date(row?.at || 0).getTime(),
    }))
    .filter((row) => row.mmr > 0 && Number.isFinite(row.time) && row.time > 0)
    .sort((a, b) => a.time - b.time);

  /** @type {MmrChange[]} */
  const changes = [];
  let previous = null;

  for (const row of rows) {
    if (previous === null) {
      // Ilk okuma bir "degisim" degildir; kiyaslanacak onceki deger yok.
      previous = row.mmr;
      continue;
    }
    if (row.mmr === previous) {
      continue;
    }
    changes.push({
      at: new Date(row.time).toISOString(),
      mmr: row.mmr,
      delta: row.mmr - previous,
    });
    previous = row.mmr;
  }

  return changes;
}

/**
 * Macin bitis zamani.
 *
 * @param {import("./player-types.js").PlayerMatch} match
 * @returns {number} epoch ms; hesaplanamiyorsa 0
 */
function matchEndedAt(match) {
  const start = new Date(match?.startedAt || 0).getTime();
  if (!Number.isFinite(start) || start <= 0) {
    return 0;
  }
  return start + Number(match?.durationSeconds || 0) * 1000;
}

/**
 * MMR degisimlerini maclara baglar.
 *
 * Her degisim, kendisinden ONCE biten ve pencere icinde kalan EN YAKIN maca
 * atanir. Bir maca birden fazla degisim dusemez; ilk eslesen kazanir.
 *
 * @param {Object} input
 * @param {import("./player-types.js").PlayerMatch[]} input.matches
 * @param {MmrSample[]} [input.samples] Ham okumalar
 * @param {MmrChange[]} [input.changes] Hazir degisimler (verilirse samples yok sayilir)
 * @param {number} [input.windowMs]
 * @returns {Record<string, { delta: number, mmr: number, at: string }>} matchId -> degisim
 */
export function attributeMmrToMatches(input) {
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const windowMs = Number(input?.windowMs) || MMR_MATCH_WINDOW_MS;
  const changes = Array.isArray(input?.changes)
    ? input.changes
    : toMmrChanges(input?.samples || []);

  const leadMs = Number(input?.leadMs) || MMR_MATCH_LEAD_MS;

  const ordered = matches
    .map((match) => ({ match, endedAt: matchEndedAt(match) }))
    .filter((row) => row.endedAt > 0);

  /** @type {Record<string, { delta: number, mmr: number, at: string }>} */
  const byMatch = {};

  for (const change of changes) {
    const changedAt = new Date(change.at).getTime();
    if (!Number.isFinite(changedAt)) {
      continue;
    }

    // Uygun maclar: okuma, macin bitisinden `leadMs` kadar once ile `windowMs`
    // kadar sonra arasinda olmali. Aralarindan bitisi EN YAKIN olan secilir —
    // "ilk bulunani al" demek, arka arkaya oynanan maclarda yanlis satira
    // yazmaya yol aciyordu.
    let best = null;
    let bestDistance = Infinity;

    for (const row of ordered) {
      if (byMatch[row.match.matchId]) {
        continue;
      }
      const offset = changedAt - row.endedAt;
      if (offset < -leadMs || offset > windowMs) {
        continue;
      }
      const distance = Math.abs(offset);
      if (distance < bestDistance) {
        best = row;
        bestDistance = distance;
      }
    }

    if (best) {
      byMatch[best.match.matchId] = {
        delta: change.delta,
        mmr: change.mmr,
        at: change.at,
      };
    }
  }

  return byMatch;
}

/**
 * Yeni okumalari mevcut gecmise ekler.
 *
 * Kaynak (DotaPlus logu) donerek eski satirlari silebilir; bu yuzden okunan
 * degerler KENDI depomuzda birikir. Ayni ana ait tekrarlar elenir ve liste
 * sinirli tutulur.
 *
 * @param {MmrSample[]} existing
 * @param {MmrSample[]} incoming
 * @param {{ limit?: number }} [options]
 * @returns {MmrSample[]}
 */
export function mergeMmrSamples(existing, incoming, options = {}) {
  const limit = Number(options.limit) || 2000;
  /** @type {Map<string, MmrSample>} */
  const byKey = new Map();

  for (const row of [...(existing || []), ...(incoming || [])]) {
    const at = String(row?.at || "");
    const mmr = Number(row?.mmr) || 0;
    const time = new Date(at).getTime();
    if (!mmr || !Number.isFinite(time) || time <= 0) {
      continue;
    }
    // Ayni saniyedeki ayni deger tek kayit sayilir.
    byKey.set(time + ":" + mmr, { at: new Date(time).toISOString(), mmr });
  }

  return [...byKey.values()]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-limit);
}
