/**
 * Oyuncu detayindaki "Oyun tarzi" ve "Guclu ve zayif yonler" kartlarinin
 * VERIDEN uretilen hali.
 *
 * NEDEN: Bu kartlar tohum veriden (`players.seed.js` -> character) elle
 * yazilmis metinleri gosteriyordu. Metinler degismedigi icin secili donemle
 * celisebiliyordu: haftada 3 mac oynayan birine "aktif oynama" guclu yon,
 * 23 mac oynayan birine "aktif oynama eksikligi" zayif yon olarak
 * gorunuyordu. Burada her sey secili donemdeki maclardan ve o maclarin
 * degerlendirmelerinden (faktor puanlari) turetilir.
 *
 * DOGRULUK ONCE: yeterli mac yoksa (`STYLE_MIN_MATCHES`) hicbir yorum
 * uretilmez. Bir yon ancak hem ORTALAMASI belirgin hem de maclarin
 * cogunda ayni yondeyse yazilir; tek bir iyi ya da kotu mac sonucu
 * degistiremez. Az ama dogru.
 *
 * NEDEN METIN DEGIL FAKTOR: degerlendirmedeki "Geliştirilecek" metinleri
 * sayi tasiyor ("7 olum (saatlik 9.8)"), ayni sorun her macta farkli metin
 * uretiyor. Gruplama faktor anahtariyla (`breakdown[].key`) yapilir.
 *
 * SAF FONKSIYON: depo okumaz, saat okumaz, ag istegi yapmaz.
 */

/** Yorum yapmak icin gereken en az degerlendirilmis mac. */
export const STYLE_MIN_MATCHES = 5;

/** Faktor ortalamasinin "belirgin" sayildigi esik (puanlar -1..1). */
const TRAIT_THRESHOLD = 0.2;
/** Bir yonun yazilmasi icin maclarin en az bu kadarinda ayni yonde olmali. */
const TRAIT_CONSISTENCY = 0.5;
/**
 * Gelisim alani: ortalamasi zayif sayilmayan ama maclarin en az bu kadarinda
 * beklenenin altinda kalan faktor (tutarsiz taraf).
 */
const DEVELOPMENT_SHARE = 0.35;
/** Bir faktorun yoruma girmesi icin degerlendirmelerin en az bu kadarinda olmali. */
const FACTOR_COVERAGE = 0.5;
/** Her listede en fazla bu kadar madde. */
const MAX_ITEMS = 3;
/** Rol dagiliminda gosterilen en az pay. */
const ROLE_MIN_SHARE = 0.15;

/** Faktor anahtari -> ekrandaki ad. Motorun etiketleri ASCII. */
const FACTOR_LABELS = {
  fightParticipation: "Fight katılımı",
  survivability: "Hayatta kalma",
  damageContribution: "Hasar katkısı",
  objectiveContribution: "Objective katkısı",
  laneOutcome: "Lane",
  farmEfficiency: "Farm",
  visionContribution: "Vision",
  opponentComparison: "Karşı pozisyon",
};

/**
 * @param {Object} input
 * @param {Array<Record<string, any>>} [input.matches] Secili donemin maclari
 * @param {Array<Record<string, any>>} [input.evaluations]
 * @returns {{
 *   enough: boolean,
 *   sample: number,
 *   minSample: number,
 *   roles: Array<{ role: string, share: number }>,
 *   averages: { kills: number, deaths: number, assists: number, participation: number|null, gpm: number, xpm: number }|null,
 *   strengths: Array<{ key: string, label: string, text: string }>,
 *   weaknesses: Array<{ key: string, label: string, text: string }>,
 *   development: Array<{ key: string, label: string, text: string }>
 * }}
 */
export function buildPlayerStyle(input = {}) {
  const matches = (Array.isArray(input.matches) ? input.matches : []).filter(
    (row) => row && row.matchId,
  );
  const byMatch = new Map(
    (Array.isArray(input.evaluations) ? input.evaluations : [])
      .filter((row) => row && row.matchId)
      .map((row) => [String(row.matchId), row]),
  );
  const pairs = matches
    .map((match) => ({ match, evaluation: byMatch.get(String(match.matchId)) }))
    .filter((row) => row.evaluation);

  const empty = {
    enough: false,
    sample: pairs.length,
    minSample: STYLE_MIN_MATCHES,
    roles: [],
    averages: null,
    strengths: [],
    weaknesses: [],
    development: [],
  };
  if (pairs.length < STYLE_MIN_MATCHES) {
    return empty;
  }

  const rows = pairs.map((row) => row.match);
  const factors = summarizeFactors(pairs);
  const fact = (key) => factFor(key, pairs);
  const item = (row, text) => ({
    key: row.key,
    label: FACTOR_LABELS[row.key] || row.key,
    text,
  });

  const strengths = factors
    .filter(
      (row) =>
        row.average >= TRAIT_THRESHOLD &&
        row.positiveShare >= TRAIT_CONSISTENCY,
    )
    .sort((a, b) => b.average - a.average)
    .slice(0, MAX_ITEMS)
    .map((row) => item(row, fact(row.key)));

  const weaknesses = factors
    .filter(
      (row) =>
        row.average <= -TRAIT_THRESHOLD &&
        row.negativeShare >= TRAIT_CONSISTENCY,
    )
    .sort((a, b) => a.average - b.average)
    .slice(0, MAX_ITEMS)
    .map((row) => item(row, fact(row.key)));

  const listed = new Set([...strengths, ...weaknesses].map((row) => row.key));
  const development = factors
    .filter(
      (row) => !listed.has(row.key) && row.negativeShare >= DEVELOPMENT_SHARE,
    )
    .sort((a, b) => b.negativeShare - a.negativeShare)
    .slice(0, MAX_ITEMS)
    .map((row) =>
      item(
        row,
        `maçların %${Math.round(row.negativeShare * 100)}'ında beklenenin altında`,
      ),
    );

  return {
    enough: true,
    sample: pairs.length,
    minSample: STYLE_MIN_MATCHES,
    roles: roleShares(pairs),
    averages: averagesOf(rows),
    strengths,
    weaknesses,
    development,
  };
}

/**
 * Faktor bazinda ortalama ve tutarlilik.
 * @param {Array<{ evaluation: Record<string, any> }>} pairs
 */
function summarizeFactors(pairs) {
  /** @type {Map<string, number[]>} */
  const scores = new Map();
  for (const { evaluation } of pairs) {
    for (const factor of evaluation.breakdown || []) {
      const value = Number(factor?.score);
      if (!factor?.key || !Number.isFinite(value)) {
        continue;
      }
      const list = scores.get(factor.key) || [];
      list.push(value);
      scores.set(factor.key, list);
    }
  }
  return [...scores.entries()]
    .filter(([, list]) => list.length >= pairs.length * FACTOR_COVERAGE)
    .map(([key, list]) => ({
      key,
      average: list.reduce((total, value) => total + value, 0) / list.length,
      positiveShare:
        list.filter((value) => value > TRAIT_THRESHOLD).length / list.length,
      negativeShare:
        list.filter((value) => value < -TRAIT_THRESHOLD).length / list.length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Faktorun olculen karsiligi (yorum degil, sayi).
 * @param {string} key
 * @param {Array<{ match: Record<string, any>, evaluation: Record<string, any> }>} pairs
 * @returns {string}
 */
function factFor(key, pairs) {
  const rows = pairs
    .filter(({ evaluation }) =>
      (evaluation.breakdown || []).some((factor) => factor?.key === key),
    )
    .map((row) => row.match);
  const mean = (value) =>
    rows.length
      ? rows.reduce((total, row) => total + value(row), 0) / rows.length
      : 0;
  const minutes = (row) => Math.max(1, Number(row.durationSeconds || 0) / 60);

  switch (key) {
    case "fightParticipation": {
      const known = rows.filter((row) => Number(row.teamKills) > 0);
      if (!known.length) {
        return "";
      }
      const share =
        known.reduce(
          (total, row) =>
            total +
            (Number(row.kills || 0) + Number(row.assists || 0)) /
              Number(row.teamKills),
          0,
        ) / known.length;
      return `ort. %${Math.round(share * 100)} kill katılımı`;
    }
    case "survivability":
      return `maç başına ${round1(mean((row) => Number(row.deaths || 0)))} ölüm`;
    case "damageContribution":
      return `dakikada ${Math.round(
        mean((row) => Number(row.heroDamage || 0) / minutes(row)),
      )} hero hasarı`;
    case "objectiveContribution":
      return `maç başına ${Math.round(
        mean((row) => Number(row.towerDamage || 0)),
      )} kule hasarı`;
    case "farmEfficiency":
      return `${Math.round(mean((row) => Number(row.gpm || 0)))} GPM / ${Math.round(
        mean((row) => Number(row.xpm || 0)),
      )} XPM`;
    case "visionContribution":
      return `maç başına ${round1(
        mean((row) => Number(row.obsPlaced || 0) + Number(row.senPlaced || 0)),
      )} ward`;
    default:
      return "";
  }
}

/**
 * Pozisyonu gercekten bilinen maclarda (bkz. RELIABLE_ROLE_SOURCES)
 * pozisyonlarin payi. Basliktaki rollerle (deriveRoleProfile) ayni kural.
 * @param {Array<{ evaluation: Record<string, any> }>} pairs
 */
function roleShares(pairs) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  let known = 0;
  for (const { evaluation } of pairs) {
    const role = reliableRoleOf(evaluation);
    if (role) {
      known += 1;
      counts.set(role, (counts.get(role) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([role, count]) => ({
      role,
      share: Math.round((count / known) * 100) / 100,
    }))
    .filter((row) => row.share >= ROLE_MIN_SHARE)
    .sort((a, b) => b.share - a.share || a.role.localeCompare(b.role));
}

/** @param {Array<Record<string, any>>} rows */
function averagesOf(rows) {
  const mean = (field) =>
    round1(
      rows.reduce((total, row) => total + Number(row[field] || 0), 0) /
        rows.length,
    );
  const known = rows.filter((row) => Number(row.teamKills) > 0);
  const participation = known.length
    ? Math.round(
        (known.reduce(
          (total, row) =>
            total +
            (Number(row.kills || 0) + Number(row.assists || 0)) /
              Number(row.teamKills),
          0,
        ) /
          known.length) *
          100,
      ) / 100
    : null;
  return {
    kills: mean("kills"),
    deaths: mean("deaths"),
    assists: mean("assists"),
    participation,
    gpm: Math.round(mean("gpm")),
    xpm: Math.round(mean("xpm")),
  };
}

/** @param {number} value */
function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Pozisyonu GERCEKTEN bilinen degerlendirme kaynaklari: elle secim, takim
 * dagilimi, saglayici. Istatistikten cikarim ("inferred") yalnizca core /
 * destek ayrimini yapabiliyor — core oynanan her maci pos1 sayiyor — ve
 * "profile" tohum rolunun kendisi; ikisi de rol dagilimina katilmaz.
 */
export const RELIABLE_ROLE_SOURCES = new Set(["manual", "team", "provider"]);

/** @param {Record<string, any>|undefined} evaluation */
export function reliableRoleOf(evaluation) {
  const role = String(evaluation?.role || "");
  return /^pos[1-5]$/.test(role) &&
    RELIABLE_ROLE_SOURCES.has(String(evaluation?.roleSource || ""))
    ? role
    : "";
}

/** Rolleri mac verisinden turetmek icin gereken en az degerlendirme. */
export const ROLE_PROFILE_MIN_MATCHES = 5;
/** Oyuncunun rolu sayilmasi icin gereken en az pay. */
const ROLE_PROFILE_MIN_SHARE = 0.15;
/** Birincil + ikincil en fazla bu kadar rol. */
const ROLE_PROFILE_MAX_ROLES = 3;

/**
 * Oyuncunun rollerini (birincil + ikincil) degerlendirmelerdeki pozisyon
 * dagilimindan turetir: "Pos 3 %44 · Pos 2 %31 · Pos 4 %19" -> birincil
 * pos3, ikincil [pos2, pos4].
 *
 * NEDEN: roller tohum veride (`players.seed.js`) elle yaziliydi; yeni
 * eklenen oyuncuda hic yoktu, mevcut oyuncuda da oynadigi rolle
 * celisebiliyordu. Yalnizca pozisyonu gercekten bilinen maclar sayilir (bkz.
 * RELIABLE_ROLE_SOURCES): istatistik cikarimi core oynayan herkesi pos1
 * yapiyordu, tohum rolune dusulmus degerlendirme ise tohumu kendi kendini
 * dogrulayan bir donguye sokardi.
 *
 * @param {Array<Record<string, any>>} evaluations
 * @returns {{
 *   primaryRole: string,
 *   secondaryRoles: string[],
 *   roleShares: Array<{ role: string, share: number, matches: number }>,
 *   sample: number
 * }|null} Yeterli veri yoksa null (cagiran tohum rollerini korur)
 */
export function deriveRoleProfile(evaluations) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  let sample = 0;
  for (const row of Array.isArray(evaluations) ? evaluations : []) {
    const role = reliableRoleOf(row);
    if (!role) {
      continue;
    }
    sample += 1;
    counts.set(role, (counts.get(role) || 0) + 1);
  }
  if (sample < ROLE_PROFILE_MIN_MATCHES) {
    return null;
  }
  const roleShares = [...counts.entries()]
    .map(([role, matches]) => ({
      role,
      matches,
      share: Math.round((matches / sample) * 100) / 100,
    }))
    .sort((a, b) => b.matches - a.matches || a.role.localeCompare(b.role));
  const roles = roleShares
    .filter((row, index) => index === 0 || row.share >= ROLE_PROFILE_MIN_SHARE)
    .slice(0, ROLE_PROFILE_MAX_ROLES)
    .map((row) => row.role);
  return {
    primaryRole: roles[0],
    secondaryRoles: roles.slice(1),
    roleShares,
    sample,
  };
}
