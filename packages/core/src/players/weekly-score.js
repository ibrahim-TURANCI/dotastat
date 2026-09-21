/**
 * Donem siralamasi: "bu hafta / bu ay kim iyi gitti, kim kotu gitti".
 *
 * SORU: bunun tek bir maclik sansla cevaplanmamasi.
 *
 * Bu yuzden siralama dort olcutun BIRLESIMIDIR:
 *   1. Gercek MMR degisimi   (olculemiyorsa mac sonucundan tahmin edilir)
 *   2. Galibiyet/maglubiyet dengesi
 *   3. Performance Rank degisimi (bu haftaki ortalama vs. onceki donem)
 *   4. Oynanan mac sayisi
 *
 * ORNEK SAYISI AYRI BIR OLCUT DEGIL, HEPSININ CARPANIDIR: 1 mac oynayip
 * kazanan biri haftanin birincisi olamaz, cunku basari kismi `confidence`
 * ile carpilir (1 macta 0.2, 10 macta 0.71). Ayrica dogrudan bir hacim
 * bonusu/cezasi vardir — az oynayan ortalamanin altinda kalir.
 *
 * Modul SAFTIR: saat okumaz (`now` disaridan gelir), ag istegi yapmaz.
 */

import { buildStatsFromMatches } from "../providers/match-stats.js";
import { attributeMmrToMatches, resolveRankProgress } from "./mmr-history.js";
import { shrunkWinRate } from "./hero-pool.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Secilebilen donemler.
 *
 * Arayuzde "Hafta / Ay / Son 60" olarak gorunur. Ucu de AYNI puanlama
 * mantigini kullanir; degisen yalnizca pencere genisligidir, boylece sekmeler
 * arasinda gecerken sayilarin anlami degismez.
 *
 * SON 60 bir takvim penceresi DEGILDIR: elde ne kadar mac varsa onun tamamidir.
 * Onbellek oyuncu basina son `MATCH_FETCH_SIZE` maci tuttugu icin bu pratikte
 * "son 60 mac" demektir ve etiket bunu ACIKCA yazar — "Genel" diyordu, ama
 * gosterdigi sey oyuncunun tum kariyeri degil, elde duran pencereydi.
 * `windowMs` sonsuz, `days` 0'dir; arayuz "son N gun" yazmaz. Esiklerin nasil
 * olceklendigi icin bkz. `buildWeeklyEntry`.
 *
 * ETIKETTEKI SAYI `MATCH_FETCH_SIZE` ile ayni kalmalidir. Burada elle
 * yaziliyor cunku o sabit `player-data-service` icinde ve oradan almak
 * dairesel bir bagimlilik kurardi; bunun yerine bir test ikisini karsilastirir
 * (bkz. test/period-score.test.js).
 */
export const PERIODS = {
  week: { key: "week", label: "Hafta", days: 7, windowMs: 7 * DAY_MS },
  month: { key: "month", label: "Ay", days: 30, windowMs: 30 * DAY_MS },
  all: { key: "all", label: "Son 60", days: 0, windowMs: Infinity },
};

/**
 * Donem bir takvim penceresi mi, yoksa "elde ne varsa" mi?
 *
 * @param {{ windowMs?: number }} period
 * @returns {boolean}
 */
export function isAllTimePeriod(period) {
  return !Number.isFinite(Number(period?.windowMs));
}

/**
 * Kartta gosterilecek hero sayisi.
 *
 * Serit 5 hero tasiyordu; kartta yer var ve donem sekmesi genisledikce (Ay,
 * Son 60) 5 hero oyuncunun ne oynadigini anlatmaya yetmiyor.
 */
export const PERIOD_HERO_COUNT = 8;

/** Donem verilmezse kullanilan. */
export const DEFAULT_PERIOD = "week";

/** Tablo kac gunluk pencereye bakar (varsayilan donem). */
export const WEEKLY_WINDOW_MS = PERIODS.week.windowMs;

/**
 * Performance Rank degisiminin kiyaslandigi gecmis donem, pencerenin KATI
 * olarak.
 *
 * Donemin ortalamasi, ondan ONCEKI ucu kadar surenin ortalamasiyla kiyaslanir
 * (yani toplam geriye bakis pencerenin 4 kati). Daha uzun bir taban aliniyor
 * cunku tek bir haftanin ortalamasi 3-4 macla savruluyor ve "degisim" olcutu
 * gurultuye donusuyor. Ayni oran ayda da korunur ki iki sekme ayni seyi
 * olcsun.
 */
export const BASELINE_WINDOW_FACTOR = 4;

/** Varsayilan donemin taban penceresi (geriye donuk uyum icin). */
export const BASELINE_WINDOW_MS =
  PERIODS.week.windowMs * BASELINE_WINDOW_FACTOR;

/**
 * Donem anahtarini tanimina cevirir; taninmayan deger varsayilana duser.
 *
 * @param {unknown} value
 * @returns {{ key: string, label: string, days: number, windowMs: number }}
 */
export function resolvePeriod(value) {
  const key = String(value || "").toLowerCase();
  return PERIODS[key] || PERIODS[DEFAULT_PERIOD];
}

/**
 * MMR okunamayan maclarda mac basina varsayilan degisim.
 *
 * Dota'da tek maclik MMR degisimi 20-30 bandindadir. Kurulumu yapmamis
 * oyuncular icin (ve kurulum yapmis olsa da uygulama kapaliyken oynanan
 * maclar icin) bu deger kullanilir; sonuc `mmrSource` ile isaretlenir.
 */
export const ESTIMATED_MMR_PER_MATCH = 25;

/**
 * ESIKLER BIR HAFTAYA GORE KALIBRE EDILDI.
 *
 * Ay sekmesinde oldugu gibi kullanilsalardi tablo anlamsizlasirdi: 30/30
 * oynayan biri (tam olarak ortalama) hacim bonusunu sonuna kadar alip "iyi
 * gidiyor" gorunurdu, cunku 12 maclik tavan bir ayda herkesce asiliyor. Bu
 * yuzden esikler pencere genisligiyle birlikte buyur (bkz. `windowScale`) ve
 * iki sekme AYNI SEYI olcer: "bu donemde ortalamanin ne kadar
 * uzerinde/altinda". Son 60 sekmesinde takvim yerine mac sayisi kullanilir;
 * gerekcesi `buildWeeklyEntry` icinde.
 */

/**
 * `confidence` egrisinin onceligi: bu kadar "hayali mac" eklenir (haftalik).
 *
 * 1 mac -> 0.20, 4 mac -> 0.50, 10 mac -> 0.71, 20 mac -> 0.83.
 */
const CONFIDENCE_PRIOR = 4;

/** Hacim bonusunun tavana ulastigi mac sayisi (haftalik). */
const VOLUME_FULL_MATCHES = 12;

/** Puan agirliklari (toplami, guven 1 iken +-80'e denk gelir). */
const WEIGHTS = {
  mmr: 34,
  win: 26,
  performance: 20,
  /** Hacim +-6 puan oynatir; tek basina siralamayi cevirmez. */
  volume: 12,
};

/** Bu MMR degisimi tam puan sayilir (haftalik ~+-300). */
const MMR_FULL_SCALE = 300;
/**
 * Bu Performance Rank degisimi tam puan sayilir.
 *
 * Donemle OLCEKLENMEZ: Performance Rank bir ORTALAMA, toplam degil. Bir ayin
 * ortalamasi bir haftanin ortalamasindan buyuk olmaz.
 */
const PERFORMANCE_FULL_SCALE = 400;

/** Nötr puan; herkes buradan baslar. */
const BASE_SCORE = 50;

/**
 * Kart cercevesinin renk degistirmesi icin gereken sapma.
 *
 * Bant olmadan 50.2 puan "iyi", 49.8 "kotu" gorunurdu; ikisi de aslinda
 * "ortalama" demek. Bu genislikte bir notr bant, renklerin gercekten bir sey
 * soylemesini sagliyor.
 */
const SCORE_TONE_MARGIN = 6;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {unknown} value
 * @returns {number} epoch ms; cozulemezse 0
 */
function timeOf(value) {
  const at = new Date(value || 0).getTime();
  return Number.isFinite(at) && at > 0 ? at : 0;
}

/**
 * @param {Array<Record<string, any>>} evaluations
 * @param {string[]} matchIds
 * @returns {number} ortalama Performance Rank; hic yoksa 0
 */
function averagePerformanceRank(evaluations, matchIds) {
  const wanted = new Set(matchIds);
  const rows = evaluations.filter((row) => wanted.has(String(row?.matchId)));
  if (!rows.length) {
    return 0;
  }
  const total = rows.reduce(
    (sum, row) => sum + (Number(row?.performanceRank) || 0),
    0,
  );
  return Math.round(total / rows.length);
}

/**
 * Bir oyuncunun donem ozeti.
 *
 * @param {Object} input
 * @param {Record<string, any>} input.player
 * @param {Array<Record<string, any>>} [input.matches]      En yeni once
 * @param {Array<Record<string, any>>} [input.evaluations]  matchId ile eslesir
 * @param {Array<{ at: string, mmr: number }>} [input.samples]
 * @param {number} [input.now] epoch ms
 * @param {string} [input.period] "week" | "month" | "all"
 * @returns {Record<string, any>}
 */
export function buildWeeklyEntry(input) {
  const player = input?.player || {};
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const evaluations = Array.isArray(input?.evaluations)
    ? input.evaluations
    : [];
  const now = Number(input?.now) || Date.now();
  const period = resolvePeriod(input?.period);
  const allTime = isAllTimePeriod(period);
  const since = now - period.windowMs;
  const baselineSince = now - period.windowMs * BASELINE_WINDOW_FACTOR;

  const weekly = matches.filter((row) => {
    const at = timeOf(row?.startedAt);
    // Son 60'ta pencere yok: tarihi cozulebilen her mac sayilir.
    return allTime ? at > 0 : at >= since;
  });
  // SON 60'TA TABAN YOKTUR: pencere zaten tum veriyi kapsiyor, "ondan onceki
  // donem" diye bir sey kalmiyor. Performance Rank degisimi bu yuzden Son 60
  // sekmesinde hesaplanmaz (`hasBaseline: false`) — uydurma bir 0 gostermek,
  // "degismedi" demek olurdu.
  const baseline = allTime
    ? []
    : matches.filter((row) => {
        const at = timeOf(row?.startedAt);
        return at > 0 && at < since && at >= baselineSince;
      });

  const wins = weekly.filter((row) => row?.result === "win").length;
  const losses = weekly.length - wins;

  // MMR: olculebilen maclarda GERCEK degisim, digerlerinde mac basina tahmin.
  // Ikisi ayri sayilir ki arayuz "olculdu / kismi / tahmin" diyebilsin.
  const mmrByMatch = attributeMmrToMatches({
    matches: weekly,
    samples: input?.samples || [],
  });
  let measuredDelta = 0;
  let measuredMatches = 0;
  let estimatedDelta = 0;

  for (const row of weekly) {
    const change = mmrByMatch[row.matchId];
    if (change) {
      measuredDelta += Number(change.delta) || 0;
      measuredMatches += 1;
      continue;
    }
    estimatedDelta +=
      (row?.result === "win" ? 1 : -1) * ESTIMATED_MMR_PER_MATCH;
  }

  const mmrDelta = measuredDelta + estimatedDelta;
  const mmrSource = !weekly.length
    ? "none"
    : measuredMatches === weekly.length
      ? "measured"
      : measuredMatches > 0
        ? "partial"
        : "estimated";

  const weeklyPerformanceRank = averagePerformanceRank(
    evaluations,
    weekly.map((row) => String(row.matchId)),
  );
  const baselinePerformanceRank = averagePerformanceRank(
    evaluations,
    baseline.map((row) => String(row.matchId)),
  );
  const hasBaseline = baselinePerformanceRank > 0 && weeklyPerformanceRank > 0;
  const performanceDelta = hasBaseline
    ? weeklyPerformanceRank - baselinePerformanceRank
    : 0;

  // --- Puan ---------------------------------------------------------------
  //
  // Basari kismi (MMR + galibiyet + performans) guvenle carpilir; hacim
  // bonusu ayri durur cunku "az oynadi" bilgisinin kendisi bir sonuctur.
  // SON 60'TA OLCEK TAKVIMLE DEGIL MAC SAYISIYLA KURULUR.
  //
  // Esikler bir haftaya gore kalibre edildi ve Ay sekmesinde pencere
  // genisligiyle birlikte buyuyor. Son 60'ta boyle bir genislik yok (pencere
  // sonsuz); takvim carpani kullanilsaydi esikler de sonsuza giderdi ve
  // herkesin puani ayni cikardi. Bunun yerine Son 60, ORANLARI olcer:
  //   - guven dogrudan mac sayisindan gelir (haftalik onceligin aynisi),
  //   - MMR esigi "mac basina 25" uzerinden kurulur (300 / 12 mac),
  //   - hacim bonusu YOKTUR: "tum zamanlarda cok oynamis olmak" bir donem
  //     performansi degildir, yalnizca kidemdir.
  const windowScale = allTime ? 1 : period.windowMs / PERIODS.week.windowMs;

  const confidencePrior = CONFIDENCE_PRIOR * windowScale;
  const confidence = weekly.length / (weekly.length + confidencePrior);

  const mmrScale = allTime
    ? (MMR_FULL_SCALE / VOLUME_FULL_MATCHES) * Math.max(weekly.length, 1)
    : MMR_FULL_SCALE * windowScale;

  const mmrPoints = clamp(mmrDelta / mmrScale, -1, 1) * WEIGHTS.mmr;
  const winPoints =
    clamp((shrunkWinRate(wins, weekly.length) - 0.5) * 2, -1, 1) * WEIGHTS.win;
  const performancePoints = hasBaseline
    ? clamp(performanceDelta / PERFORMANCE_FULL_SCALE, -1, 1) *
      WEIGHTS.performance
    : 0;
  const volumePoints = allTime
    ? 0
    : (Math.min(weekly.length / (VOLUME_FULL_MATCHES * windowScale), 1) - 0.5) *
      WEIGHTS.volume;

  /**
   * BASARI kismi: MMR + galibiyet + performans, guvenle carpilmis.
   *
   * Puandan ayri tutuluyor cunku kartin CERCEVE RENGI bunu kullaniyor. Hacim
   * bonusu renge karismamali: bir ayda 30/30 oynayan oyuncu tam olarak
   * ortalamadir, ama hacim bonusu tek basina onu +6'ya tasiyip kartini yesil
   * yapiyordu — "iyi gidiyor" diyen bir renk, hicbir sey basarmamis birine.
   */
  const meritPoints = confidence * (mmrPoints + winPoints + performancePoints);

  const score = weekly.length ? BASE_SCORE + meritPoints + volumePoints : 0;

  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar || "",
    /** Hangi donemin ozeti oldugu; arayuz metinleri buna bakar. */
    period: period.key,
    periodDays: period.days,
    rank: player.rank || null,
    primaryRole: player.dotaProfile?.primaryRole || "",
    /**
     * Su anki MMR. Kurulumu yapmis oyuncuda OLCULEN deger, digerlerinde
     * madalyadan turetilmis tahmin (`approximate: true`).
     */
    mmrProgress: resolveRankProgress({
      samples: input?.samples || [],
      rank: player.rank || null,
    }),

    matches: weekly.length,
    wins,
    losses,
    winRate: weekly.length ? Number((wins / weekly.length).toFixed(4)) : 0,
    form: weekly.map((row) => (row?.result === "win" ? "win" : "loss")),

    /**
     * Donemin en cok oynanan hero'lari (karttaki ikon seridi).
     *
     * SECILEN DONEMDEN turer, kartin genel istatistiginden degil: "bu hafta ne
     * oynadi" ile "hep ne oynar" farkli sorular ve kartin geri kalani (G/M,
     * MMR, Performance Rank) zaten donemi anlatiyor. Ikisi karisinca kart
     * kendi icinde celisiyordu — hafta sekmesinde 2 mac yazarken serit
     * aylardir oynanan hero'lari gosteriyordu.
     *
     * Hesap `buildStatsFromMatches` ile yapilir; hero sayma mantigi tek bir
     * yerde dursun.
     */
    topHeroes: buildStatsFromMatches(
      String(player.player_id || ""),
      weekly,
      "period",
    ).heroes.slice(0, PERIOD_HERO_COUNT),

    mmrDelta: Math.round(mmrDelta),
    mmrSource,
    measuredMatches,

    performanceRank: weeklyPerformanceRank,
    baselinePerformanceRank,
    performanceDelta: Math.round(performanceDelta),
    hasBaseline,

    /** Maci olmayan oyuncu siralamaya girmez; ayri listelenir. */
    ranked: weekly.length > 0,
    score: Number(score.toFixed(1)),
    /**
     * Kart cercevesinin rengi: "up" iyi, "down" kotu, "flat" ortalama.
     *
     * PUANA DEGIL, basari kismina bakar — hacim bonusu renge karismaz (bkz.
     * `meritPoints`). Esik arayuzde degil BURADA duruyor; iki yerde
     * tanimlansaydi masaustu ile site farkli renk gosterebilirdi.
     */
    tone: !weekly.length
      ? "flat"
      : meritPoints >= SCORE_TONE_MARGIN
        ? "up"
        : meritPoints <= -SCORE_TONE_MARGIN
          ? "down"
          : "flat",
    /** Cerceve renginin dayandigi ham deger (hata ayiklama ve ipucu icin). */
    meritPoints: Number(meritPoints.toFixed(1)),
    breakdown: {
      confidence: Number(confidence.toFixed(3)),
      mmr: Number(mmrPoints.toFixed(1)),
      win: Number(winPoints.toFixed(1)),
      performance: Number(performancePoints.toFixed(1)),
      volume: Number(volumePoints.toFixed(1)),
    },
  };
}

/**
 * Kadronun tamami icin haftalik siralama.
 *
 * @param {Object} input
 * @param {Array<Object>} input.entries `buildWeeklyEntry` girdileri
 * @param {number} [input.now] epoch ms
 * @param {string} [input.period] "week" | "month" | "all"
 * @returns {{
 *   period: string, periodLabel: string,
 *   since: string, now: string, windowDays: number,
 *   rows: Array<Record<string, any>>,
 *   winner: Record<string, any>|null,
 *   loser: Record<string, any>|null,
 *   idle: Array<Record<string, any>>
 * }}
 */
export function buildWeeklyScoreboard(input) {
  const now = Number(input?.now) || Date.now();
  const period = resolvePeriod(input?.period);
  const rows = (Array.isArray(input?.entries) ? input.entries : [])
    .map((entry) => buildWeeklyEntry({ ...entry, now, period: period.key }))
    .filter((row) => row.id);

  const ranked = rows
    .filter((row) => row.ranked)
    // Esitlikte cok oynayan one gecer: ayni puanda daha fazla mac daha
    // guvenilir bir sonuctur.
    .sort((a, b) => b.score - a.score || b.matches - a.matches);
  const idle = rows.filter((row) => !row.ranked);

  ranked.forEach((row, index) => {
    row.position = index + 1;
  });

  return {
    period: period.key,
    periodLabel: period.label,
    // Son 60'ta baslangic yoktur (pencere tum veriyi kapsiyor); bos dize
    // doner, arayuz de "son N gun" yerine mac sayisini yazar.
    since: isAllTimePeriod(period)
      ? ""
      : new Date(now - period.windowMs).toISOString(),
    now: new Date(now).toISOString(),
    windowDays: period.days,
    rows: [...ranked, ...idle],
    // Kazanan ve kaybeden yalnizca EN AZ IKI siralanan oyuncu varken
    // anlamlidir; tek kisi hem birinci hem sonuncu olmaz.
    winner: ranked.length >= 2 ? ranked[0] : null,
    loser: ranked.length >= 2 ? ranked[ranked.length - 1] : null,
    idle,
  };
}

/**
 * Oyuncu kartlarina donem ozetini isler ve kartlari PUANA GORE siralar.
 *
 * NEDEN BURADA, ARAYUZDE DEGIL: puan kartin kendisinde yok — kart oyuncunun
 * genel degerlendirmesini tasiyor, puan ise secilen doneme ait. Siralamayi
 * arayuzde yapmak, ayni dogruyu iki yerde uretmek olurdu ve masaustu ile site
 * farkli sira gosterebilirdi.
 *
 * @param {Array<Record<string, any>>} cards `toRosterCard` ciktilari
 * @param {ReturnType<typeof buildWeeklyScoreboard>} board
 * @returns {Array<Record<string, any>>}
 */
export function withPeriodSummary(cards, board) {
  const byId = new Map((board?.rows || []).map((row) => [row.id, row]));

  const merged = (cards || []).map((card) => {
    const row = byId.get(card.id) || null;
    return {
      ...card,
      period: row
        ? {
            key: row.period,
            days: row.periodDays,
            score: row.score,
            tone: row.tone,
            position: row.position || 0,
            ranked: row.ranked,
            matches: row.matches,
            wins: row.wins,
            losses: row.losses,
            winRate: row.winRate,
            form: row.form,
            // Hero seridi de doneme aittir (bkz. buildWeeklyEntry).
            topHeroes: row.topHeroes || [],
            mmrDelta: row.mmrDelta,
            mmrSource: row.mmrSource,
            mmrProgress: row.mmrProgress,
            performanceRank: row.performanceRank,
            performanceDelta: row.performanceDelta,
            hasBaseline: row.hasBaseline,
          }
        : null,
    };
  });

  // Siralanan oyuncular puana gore, digerleri arkada adiyla.
  //
  // Maci olmayan oyuncunun puani 0; puana gore siralansaydi hepsi en dibe
  // yigilir ve "cok kotu gidiyor" gibi okunurdu. Oysa soyledigi sey yalnizca
  // "bu donemde oynamadi".
  const ranked = merged.filter((card) => card.period?.ranked);
  const idle = merged.filter((card) => !card.period?.ranked);

  ranked.sort(
    (a, b) =>
      b.period.score - a.period.score || b.period.matches - a.period.matches,
  );
  idle.sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));

  return [...ranked, ...idle];
}
