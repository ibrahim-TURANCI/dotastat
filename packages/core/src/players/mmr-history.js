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

  // Maclari bitis zamanina gore YENIDEN ESKIYE sirala; her degisim icin
  // kendisinden once biten ilk maci ariyoruz.
  const ordered = matches
    .map((match) => ({ match, endedAt: matchEndedAt(match) }))
    .filter((row) => row.endedAt > 0)
    .sort((a, b) => b.endedAt - a.endedAt);

  /** @type {Record<string, { delta: number, mmr: number, at: string }>} */
  const byMatch = {};

  for (const change of changes) {
    const changedAt = new Date(change.at).getTime();
    if (!Number.isFinite(changedAt)) {
      continue;
    }

    const hit = ordered.find(
      (row) =>
        row.endedAt <= changedAt &&
        changedAt - row.endedAt <= windowMs &&
        !byMatch[row.match.matchId],
    );

    if (hit) {
      byMatch[hit.match.matchId] = {
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
