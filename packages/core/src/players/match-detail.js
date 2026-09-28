/**
 * Tek macin TAM kadro gorunumu: on oyuncu, iki takim, herkes icin
 * Performance Rank.
 *
 * VERI: saglayicinin `getMatchDetail` ciktisi (bkz. providers/opendota.js).
 * PR'lar degerlendirme motorunun ayni olcutleriyle, ON OYUNCU ICIN DE ayni
 * tabandan (macin ortalama seviyesi) uretilir; boylece mac icinde
 * karsilastirilabilirler. Son Maclar'daki PR ise oyuncunun kendi profilini
 * taban alir ve farkli olabilir.
 *
 * POZISYONLAR TAKIM BAZINDA DAGITILIR (bkz. role-assignment.js): her
 * takimda her pozisyondan bir kisi. Kadrodan birinin o mac icin ELLE girdigi
 * pozisyon kesindir; kalanlar geri kalan yerlere dagilir. Tum oyuncular ayni
 * dagilimla degerlendirildigi icin mac icindeki PR degerleri birbiriyle
 * tutarlidir.
 *
 * SAF FONKSIYON: depo okumaz, saat okumaz, ag istegi yapmaz.
 */

import { evaluateMatchPlayer } from "./performance-evaluation-engine.js";
import { ROLE_GROUP, resolveRankTier } from "./player-types.js";
import { assignTeamRoles } from "./role-assignment.js";

/**
 * @param {Object} input
 * @param {Record<string, any>|null} input.detail Saglayicinin mac detayi
 * @param {Array<Record<string, any>>} [input.roster] Kadro kayitlari
 *   (`player_id` = 32-bit hesap kimligi)
 * @param {Record<string, string>} [input.forcedRolesByAccount] hesap kimligi
 *   -> bu macta elle girilen pozisyon
 * @param {Record<string, Record<string, any>>} [input.heroOverrides]
 * @returns {Record<string, any>|null}
 */
export function buildMatchDetailView(input) {
  const detail = input?.detail;
  const rows = Array.isArray(detail?.players) ? detail.players : [];
  if (!detail || !rows.length) {
    return null;
  }

  const rosterByAccount = new Map(
    (Array.isArray(input.roster) ? input.roster : [])
      .filter((row) => row && row.player_id)
      .map((row) => [String(row.player_id), row]),
  );
  const forcedByAccount = input.forcedRolesByAccount || {};
  const matchId = String(detail.matchId || "");
  const keyOf = (row) => "slot-" + Number(row.slot || 0);
  const sideOf = (row) =>
    row.side || (Number(row.slot) < 128 ? "radiant" : "dire");

  // Iki takimin pozisyon dagilimi.
  /** @type {Record<string, { role: string, source: string }>} */
  const roles = {};
  for (const side of ["radiant", "dire"]) {
    Object.assign(
      roles,
      assignTeamRoles(
        rows
          .filter((row) => sideOf(row) === side)
          .map((row) => ({
            id: keyOf(row),
            hero: row.hero,
            forcedRole: row.accountId
              ? forcedByAccount[String(row.accountId)] || ""
              : "",
            // Eski onbellek kayitlarinda `laneRole` yok; ayni bilgi `role`da.
            laneRole: row.laneRole ?? row.role,
            gpm: row.gpm,
            netWorth: row.netWorth,
            lastHits: row.lastHits,
            obsPlaced: row.obsPlaced,
            senPlaced: row.senPlaced,
            items: row.items,
          })),
        { heroOverrides: input.heroOverrides || {} },
      ),
    );
  }

  // MAC ICI BAGLAM: core / support ortalamalari ve karsi pozisyondaki
  // oyuncu. Degerlendirme motoru sabit olcutleri bu maca gore kalibre eder
  // ve her oyuncuyu rakip takimdaki ayni pozisyonla kiyaslar.
  const minutes = Math.max(1, Number(detail.durationSeconds || 0) / 60);
  const groupOf = (row) => ROLE_GROUP[roles[keyOf(row)]?.role] || "";
  /** @type {Record<string, Record<string, number>>} */
  const averages = {};
  for (const group of ["core", "support"]) {
    const members = rows.filter((row) => groupOf(row) === group);
    if (!members.length) {
      continue;
    }
    const mean = (value) =>
      members.reduce((total, row) => total + value(row), 0) / members.length;
    averages[group] = {
      gpm: mean((row) => Number(row.gpm || 0)),
      xpm: mean((row) => Number(row.xpm || 0)),
      lastHitsPerMinute: mean((row) => Number(row.lastHits || 0) / minutes),
      heroDamagePerMinute: mean((row) => Number(row.heroDamage || 0) / minutes),
      deathsPerHour: mean((row) => (Number(row.deaths || 0) / minutes) * 60),
    };
  }
  const opponentOf = (row) => {
    const role = roles[keyOf(row)]?.role;
    return (
      rows.find(
        (other) =>
          sideOf(other) !== sideOf(row) && roles[keyOf(other)]?.role === role,
      ) || null
    );
  };

  const players = rows.map((row) => {
    const rosterPlayer = row.accountId
      ? rosterByAccount.get(String(row.accountId)) || null
      : null;
    // Mac seviyesi TEK kaynaktan: detayin ortalamasi (servis mumkunse
    // OpenDota'nin resmi degerini yazar). Satirlardaki eski kopya kullanilmaz;
    // yoksa PR ile ekrandaki "maç seviyesi" farkli sayilara dayanirdi.
    const match = {
      ...row,
      matchId,
      averageRankTier: detail.averageRankTier ?? row.averageRankTier ?? null,
    };
    const assigned = roles[keyOf(row)] || null;

    // MAC ICI KARSILASTIRMA: on oyuncunun hepsi AYNI tabandan, macin
    // ortalama seviyesinden degerlendirilir. Oyuncunun kendi rankini (ya da
    // kadro profilini) taban almak PR'i performans yerine madalyaya
    // baglardi: Archon madalyali bir oyuncu Ancient bir macta temiz
    // oynasa bile takiminin en dusugu cikiyordu. Mac seviyesi bilinmiyorsa
    // oyuncunun kendi rankina dusulur.
    const subject =
      Number(detail.averageRankTier) > 0
        ? null
        : row.rankTier
          ? { rank: resolveRankTier(row.rankTier) }
          : null;
    let evaluation = null;
    try {
      evaluation = evaluateMatchPlayer({
        player: subject,
        match,
        forcedRole: assigned?.source === "manual" ? assigned.role : "",
        teamRole: assigned?.role || "",
        lobby: { averages, opponent: opponentOf(row) },
      });
    } catch {
      evaluation = null;
    }

    return {
      accountId: String(row.accountId || ""),
      rosterId: rosterPlayer ? String(rosterPlayer.id) : "",
      name: rosterPlayer
        ? String(rosterPlayer.name || rosterPlayer.id)
        : String(row.personaName || ""),
      anonymous: !rosterPlayer && !row.personaName,
      side: sideOf(row),
      slot: Number(row.slot || 0),
      hero: String(row.hero || ""),
      role: String(assigned?.role || evaluation?.role || ""),
      // "manual" = kadrodan biri elle girdi, "team" = takim dagilimindan.
      roleSource: assigned?.source || "",
      result: String(row.result || ""),
      kills: Number(row.kills || 0),
      deaths: Number(row.deaths || 0),
      assists: Number(row.assists || 0),
      lastHits: Number(row.lastHits || 0),
      denies: Number(row.denies || 0),
      gpm: Number(row.gpm || 0),
      xpm: Number(row.xpm || 0),
      heroDamage: Number(row.heroDamage || 0),
      heroHealing: Number(row.heroHealing || 0),
      towerDamage: Number(row.towerDamage || 0),
      level: row.level ?? null,
      netWorth: row.netWorth ?? null,
      items: Array.isArray(row.items) ? row.items : [],
      rank: row.rankTier ? resolveRankTier(row.rankTier) : null,
      performanceRank: Number(evaluation?.performanceRank) || null,
      // Degerlendirmenin aciklamasi: pencere bunu gosterir ki "Pos 3 /
      // ~3773" gibi bilgiler tablodaki rol ve mac seviyesiyle ayni olsun.
      summary: String(evaluation?.summary || ""),
      strengths: Array.isArray(evaluation?.strengths)
        ? evaluation.strengths
        : [],
      mistakes: Array.isArray(evaluation?.mistakes) ? evaluation.mistakes : [],
    };
  });

  players.sort((a, b) => a.slot - b.slot);

  return {
    matchId,
    startedAt: detail.startedAt || "",
    durationSeconds: Number(detail.durationSeconds || 0),
    radiantWin: Boolean(detail.radiantWin),
    radiantScore: detail.radiantScore ?? null,
    direScore: detail.direScore ?? null,
    averageRankTier: detail.averageRankTier ?? null,
    players,
    provider: String(detail.provider || ""),
  };
}
