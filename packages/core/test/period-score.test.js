/**
 * Donem secimi (Hafta / Ay / Son 60).
 *
 * Korunan sozlesmeler:
 *   1. Pencere genisligi degisince ESIKLER de buyur — iki sekme AYNI SEYI
 *      olcer: "bu donemde ortalamanin ne kadar uzerinde/altinda".
 *   2. Kartin cerceve rengi BASARIYA bakar, oynanan mac sayisina degil.
 *   3. Kartlar puana gore sirali doner; maci olmayan oyuncu en dibe yigilmaz.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERIOD,
  PERIODS,
  buildWeeklyEntry,
  buildWeeklyScoreboard,
  resolvePeriod,
  withPeriodSummary,
} from "../src/players/weekly-score.js";
import { MATCH_FETCH_SIZE } from "../src/players/player-data-service.js";

const NOW = new Date("2026-08-31T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {string} matchId
 * @param {"win"|"loss"} result
 * @param {number} daysAgo
 */
function match(matchId, result, daysAgo) {
  return {
    matchId,
    result,
    startedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    durationSeconds: 2400,
  };
}

/** Verilen gun araliginda birer gun arayla mac uretir. */
function matchesBetween(fromDaysAgo, toDaysAgo, result) {
  const rows = [];
  for (let day = fromDaysAgo; day <= toDaysAgo; day += 1) {
    rows.push(match(result + "-" + day, result, day));
  }
  return rows;
}

test("donem anahtari cozulur, taninmayan deger varsayilana duser", () => {
  assert.equal(resolvePeriod("week").key, "week");
  assert.equal(resolvePeriod("month").key, "month");
  assert.equal(resolvePeriod("MONTH").key, "month");
  assert.equal(resolvePeriod("").key, DEFAULT_PERIOD);
  assert.equal(resolvePeriod("yil").key, DEFAULT_PERIOD);
  assert.equal(PERIODS.week.days, 7);
  assert.equal(PERIODS.month.days, 30);
});

test("ay penceresi haftanin disinda kalan maclari sayar", () => {
  // 20 gun once oynanmis maclar: haftaya girmez, aya girer.
  const matches = [match("1", "win", 2), match("2", "win", 20)];

  const week = buildWeeklyEntry({
    now: NOW,
    period: "week",
    player: { id: "a", name: "A" },
    matches,
  });
  const month = buildWeeklyEntry({
    now: NOW,
    period: "month",
    player: { id: "a", name: "A" },
    matches,
  });

  assert.equal(week.matches, 1);
  assert.equal(month.matches, 2);
  assert.equal(week.period, "week");
  assert.equal(month.period, "month");
  assert.equal(month.periodDays, 30);
});

test("esikler donemle olceklenir: ayni oran iki sekmede de ayni yerde durur", () => {
  // Haftada 12 mac (hacim tavani) ile ayda 12*30/7 ≈ 51 mac ayni "tam hacim"
  // demek. Olcekleme olmasaydi ayda herkes tavana carpar, hacim bonusu
  // ayirt edici olmaktan cikardi.
  const weekEntry = buildWeeklyEntry({
    now: NOW,
    period: "week",
    player: { id: "a", name: "A" },
    matches: [
      ...matchesBetween(0, 5, "win"),
      ...matchesBetween(0, 5, "win").map((row, index) => ({
        ...row,
        matchId: "extra-" + index,
        result: "loss",
      })),
    ],
  });

  const monthEntry = buildWeeklyEntry({
    now: NOW,
    period: "month",
    player: { id: "a", name: "A" },
    matches: [
      ...matchesBetween(0, 25, "win"),
      ...matchesBetween(0, 25, "win").map((row, index) => ({
        ...row,
        matchId: "extra-" + index,
        result: "loss",
      })),
    ],
  });

  // Ikisi de tam %50 kazanma orani ve dolu hacim: puanlar birbirine yakin
  // olmali. Olcekleme yapilmasaydi ay tarafi belirgin sekilde sisik cikardi.
  assert.ok(
    Math.abs(weekEntry.score - monthEntry.score) < 5,
    "hafta " + weekEntry.score + " vs ay " + monthEntry.score,
  );
});

test("cerceve rengi cok oynamaya degil BASARIYA bakar", () => {
  // Tam ortalama: 30 galibiyet 30 maglubiyet, MMR degisimi yok.
  const even = [
    ...matchesBetween(0, 29, "win"),
    ...matchesBetween(0, 29, "win").map((row, index) => ({
      ...row,
      matchId: "loss-x-" + index,
      result: "loss",
    })),
  ];

  const entry = buildWeeklyEntry({
    now: NOW,
    period: "month",
    player: { id: "a", name: "A" },
    matches: even,
  });

  assert.equal(entry.matches, 60, "hacim tavanini asmali");
  assert.equal(
    entry.tone,
    "flat",
    "ortalama oynayan yesil gorunmemeli (puan " + entry.score + ")",
  );

  // Ayni hacim, ama kazanan: rengi yesile donmeli.
  const winning = [
    ...matchesBetween(0, 29, "win"),
    ...matchesBetween(0, 9, "win").map((row, index) => ({
      ...row,
      matchId: "loss-y-" + index,
      result: "loss",
    })),
  ];
  const strong = buildWeeklyEntry({
    now: NOW,
    period: "month",
    player: { id: "a", name: "A" },
    matches: winning,
  });
  assert.equal(strong.tone, "up");
});

test("kaybeden donem kirmizi cerceve verir", () => {
  const losing = [
    ...matchesBetween(0, 5, "loss"),
    ...matchesBetween(0, 1, "win"),
  ];
  const entry = buildWeeklyEntry({
    now: NOW,
    period: "week",
    player: { id: "a", name: "A" },
    matches: losing,
  });

  assert.equal(entry.tone, "down");
});

test("maci olmayan oyuncunun rengi notr", () => {
  const entry = buildWeeklyEntry({
    now: NOW,
    period: "week",
    player: { id: "a", name: "A" },
    matches: [match("eski", "loss", 40)],
  });

  assert.equal(entry.ranked, false);
  assert.equal(entry.tone, "flat", "oynamamak 'kotu gidiyor' demek degil");
  assert.equal(entry.score, 0);
});

test("scoreboard donemi yanitla birlikte bildirir", () => {
  const board = buildWeeklyScoreboard({
    now: NOW,
    period: "month",
    entries: [
      { player: { id: "a", name: "A" }, matches: [match("1", "win", 20)] },
    ],
  });

  assert.equal(board.period, "month");
  assert.equal(board.periodLabel, "Ay");
  assert.equal(board.windowDays, 30);
  assert.equal(board.rows[0].matches, 1, "20 gun oncesi aya girmeli");
});

test("kartlar puana gore siralanir, oynamayanlar arkada kalir", () => {
  const board = buildWeeklyScoreboard({
    now: NOW,
    period: "week",
    entries: [
      {
        player: { id: "zayif", name: "Zayif" },
        matches: matchesBetween(0, 5, "loss"),
      },
      {
        player: { id: "guclu", name: "Guclu" },
        matches: matchesBetween(0, 5, "win"),
      },
      { player: { id: "bos", name: "Bos" }, matches: [] },
    ],
  });

  const cards = withPeriodSummary(
    [
      { id: "bos", name: "Bos" },
      { id: "zayif", name: "Zayif" },
      { id: "guclu", name: "Guclu" },
    ],
    board,
  );

  assert.deepEqual(
    cards.map((row) => row.id),
    ["guclu", "zayif", "bos"],
    "puana gore sirali, oynamayan en sonda",
  );
  assert.equal(cards[0].period.tone, "up");
  assert.equal(cards[1].period.tone, "down");
  // Oynamayan oyuncunun ozeti VAR ama siralanmamis; kart "bu donemde mac yok"
  // diyebilmeli.
  assert.equal(cards[2].period.ranked, false);
  assert.equal(cards[2].period.matches, 0);
});

test("scoreboard'da olmayan kart ozetsiz kalir, atilmaz", () => {
  const board = buildWeeklyScoreboard({ now: NOW, entries: [] });
  const cards = withPeriodSummary([{ id: "a", name: "A" }], board);

  assert.equal(cards.length, 1, "kart listeden dusmemeli");
  assert.equal(cards[0].period, null);
});

/* --- "Son 60" sekmesi -----------------------------------------------------
 *
 * Takvim penceresi DEGILDIR: elde ne varsa onun tamami. Korunan
 * sozlesmeler: pencere hicbir maci elemez, puan olcegi mac sayisindan kurulur
 * (takvimden degil, yoksa esikler sonsuza gider ve herkes ayni puani alir) ve
 * hero seridi de secilen donemden turer.
 */

test("etiketteki sayi onbellek penceresiyle ayni kalir", () => {
  // Etiket elle yaziliyor (dairesel bagimlilik olmasin diye). Onbellek
  // penceresi degisip etiket ayni kalirsa kullaniciya yanlis bir sey soylemis
  // oluruz — bu test o kaymayi yakalar.
  assert.equal(PERIODS.all.label, "Son " + MATCH_FETCH_SIZE);
});

test("genel penceresi hicbir maci elemez", () => {
  const rows = [
    ...matchesBetween(1, 3, "win"),
    ...matchesBetween(100, 102, "loss"),
  ];

  const week = buildWeeklyEntry({
    player: { id: "p1", name: "P1" },
    matches: rows,
    now: NOW,
    period: "week",
  });
  const all = buildWeeklyEntry({
    player: { id: "p1", name: "P1" },
    matches: rows,
    now: NOW,
    period: "all",
  });

  assert.equal(week.matches, 3, "haftaya yalnizca son maclar girer");
  assert.equal(all.matches, 6, "genel, 100 gun onceki maclari da sayar");
  assert.equal(all.periodDays, 0, "genel icin gun sayisi yoktur");
});

test("genelde puan olcegi mac sayisindan kurulur, takvimden degil", () => {
  // Sonsuz pencere takvimle olceklenseydi esikler de sonsuza giderdi:
  // guven 0'a duser, herkes ayni (notr) puani alirdi. Kazanan ile kaybedenin
  // puani birbirinden AYRILMALI.
  const winner = buildWeeklyEntry({
    player: { id: "w", name: "W" },
    matches: matchesBetween(1, 40, "win"),
    now: NOW,
    period: "all",
  });
  const loser = buildWeeklyEntry({
    player: { id: "l", name: "L" },
    matches: matchesBetween(1, 40, "loss"),
    now: NOW,
    period: "all",
  });

  assert.ok(
    winner.score > loser.score + 20,
    "kazanan ile kaybeden ayrilmali, ikisi de 50'ye yapismamali",
  );
  assert.equal(winner.tone, "up");
  assert.equal(loser.tone, "down");
});

test("genelde hacim bonusu yoktur", () => {
  // Kidem bir donem performansi degildir: 40 mac oynamis biri, yalnizca cok
  // oynadigi icin one gecmemeli. Ikisi de %50 kazanirken puanlar esit olmali.
  const many = buildWeeklyEntry({
    player: { id: "m", name: "M" },
    matches: [
      ...matchesBetween(1, 20, "win"),
      ...matchesBetween(21, 40, "loss"),
    ],
    now: NOW,
    period: "all",
  });
  const few = buildWeeklyEntry({
    player: { id: "f", name: "F" },
    matches: [...matchesBetween(1, 5, "win"), ...matchesBetween(6, 10, "loss")],
    now: NOW,
    period: "all",
  });

  assert.equal(many.breakdown.volume, 0);
  assert.equal(few.breakdown.volume, 0);
});

test("genelde Performance Rank kiyasi yapilmaz", () => {
  const entry = buildWeeklyEntry({
    player: { id: "p1", name: "P1" },
    matches: matchesBetween(1, 20, "win"),
    evaluations: matchesBetween(1, 20, "win").map((row) => ({
      matchId: row.matchId,
      performanceRank: 4000,
    })),
    now: NOW,
    period: "all",
  });

  assert.equal(entry.performanceRank, 4000, "donem ortalamasi yine hesaplanir");
  assert.equal(entry.hasBaseline, false, "kiyaslanacak onceki donem yok");
  assert.equal(entry.performanceDelta, 0);
});

test("scoreboard genel donemde baslangic tarihi bildirmez", () => {
  const board = buildWeeklyScoreboard({
    entries: [
      {
        player: { id: "p1", name: "P1" },
        matches: matchesBetween(1, 3, "win"),
      },
    ],
    now: NOW,
    period: "all",
  });

  assert.equal(board.period, "all");
  assert.equal(board.periodLabel, "Son " + MATCH_FETCH_SIZE);
  assert.equal(board.since, "", "sonsuz pencerenin baslangici yoktur");
});

test("hero seridi SECILEN DONEMDEN turer", () => {
  const rows = [
    {
      ...match("a1", "win", 1),
      hero: "pudge",
      kills: 5,
      deaths: 2,
      assists: 7,
    },
    {
      ...match("a2", "win", 2),
      hero: "pudge",
      kills: 4,
      deaths: 1,
      assists: 9,
    },
    {
      ...match("b1", "win", 60),
      hero: "invoker",
      kills: 9,
      deaths: 3,
      assists: 4,
    },
    {
      ...match("b2", "loss", 61),
      hero: "invoker",
      kills: 2,
      deaths: 8,
      assists: 3,
    },
    {
      ...match("b3", "loss", 62),
      hero: "invoker",
      kills: 1,
      deaths: 9,
      assists: 2,
    },
  ];

  const week = buildWeeklyEntry({
    player: { id: "p1", name: "P1", player_id: "1" },
    matches: rows,
    now: NOW,
    period: "week",
  });
  const all = buildWeeklyEntry({
    player: { id: "p1", name: "P1", player_id: "1" },
    matches: rows,
    now: NOW,
    period: "all",
  });

  assert.deepEqual(
    week.topHeroes.map((row) => row.hero),
    ["pudge"],
    "haftada yalnizca o haftanin hero'lari gorunmeli",
  );
  assert.deepEqual(
    all.topHeroes.map((row) => row.hero),
    ["invoker", "pudge"],
    "genelde tum maclar sayilir, cok oynanan basa gelir",
  );
  assert.equal(all.topHeroes[0].matches, 3);
});

test("donem ozeti hero seridini karta tasir", () => {
  const board = buildWeeklyScoreboard({
    entries: [
      {
        player: { id: "p1", name: "P1", player_id: "1" },
        matches: [{ ...match("a1", "win", 1), hero: "pudge" }],
      },
    ],
    now: NOW,
    period: "week",
  });

  const [card] = withPeriodSummary(
    [{ id: "p1", name: "P1", topHeroes: [] }],
    board,
  );
  assert.deepEqual(
    card.period.topHeroes.map((row) => row.hero),
    ["pudge"],
  );
});
