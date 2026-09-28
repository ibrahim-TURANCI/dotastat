/**
 * Bir oyuncunun maclarinda KADRODAN KIMLERIN oldugu.
 *
 * NEDEN ONBELLEKTEN: mac satirlari yalnizca oyuncunun KENDI istatistigini
 * tasiyor (bkz. providers/opendota.js). Macin tam kadrosu icin mac basina
 * bir `/matches/{id}` istegi gerekirdi; 25 satirlik bir liste 25 istek
 * demek ve gunluk limit bunu kaldirmaz. Oysa kadrodaki herkesin mac listesi
 * zaten onbellekte duruyor: ayni `matchId` iki oyuncunun listesinde geciyorsa
 * ikisi o macta birlikteydi. Bu modul o eslesmeyi yapar; AG ISTEGI ATMAZ.
 *
 * TAKIM AYRIMI: iki satirda da `side` varsa ona bakilir. Eski kayitlarda
 * `side` yok; o zaman sonuca bakilir — ayni macta biri kazanip digeri
 * kaybettiyse karsi takimdalar.
 *
 * SAF FONKSIYON: depo okumaz, saat okumaz.
 */

/**
 * @typedef {Object} SquadMember
 * @property {string} id           Kadro kimligi
 * @property {string} name
 * @property {string} avatar
 * @property {boolean} self        Bakilan oyuncunun kendisi mi
 * @property {"ally"|"enemy"} team Bakilan oyuncuya gore taraf
 * @property {string} hero
 * @property {string} role
 * @property {string} side
 * @property {string} result
 * @property {number} kills
 * @property {number} deaths
 * @property {number} assists
 * @property {number} lastHits
 * @property {number} denies
 * @property {number} gpm
 * @property {number} xpm
 * @property {number} heroDamage
 * @property {number} heroHealing
 * @property {number} towerDamage
 * @property {number|null} performanceRank
 */

/**
 * @param {Object} input
 * @param {string} input.playerId Bakilan oyuncunun KADRO kimligi (`player.id`)
 * @param {Array<Record<string, any>>} input.matches Bakilan oyuncunun maclari
 * @param {Array<{
 *   id: string,
 *   name?: string,
 *   avatar?: string,
 *   matches?: Array<Record<string, any>>,
 *   evaluations?: Array<Record<string, any>>
 * }>} input.roster Kadrodaki herkesin (bakilan dahil) onbellekteki verisi
 * @returns {Record<string, { members: SquadMember[], allies: number, enemies: number }>}
 */
export function buildMatchSquads(input) {
  const playerId = String(input?.playerId || "");
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const roster = Array.isArray(input?.roster) ? input.roster : [];

  // Kadro uyesi -> matchId -> satir. Her liste bir kez indekslenir.
  const indexed = roster
    .filter((row) => row && row.id)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name || row.id),
      avatar: String(row.avatar || ""),
      byMatch: new Map(
        (Array.isArray(row.matches) ? row.matches : [])
          .filter((match) => match && match.matchId)
          .map((match) => [String(match.matchId), match]),
      ),
      rankByMatch: new Map(
        (Array.isArray(row.evaluations) ? row.evaluations : [])
          .filter((evaluation) => evaluation && evaluation.matchId)
          .map((evaluation) => [
            String(evaluation.matchId),
            Number(evaluation.performanceRank) || null,
          ]),
      ),
    }));

  /** @type {Record<string, { members: SquadMember[], allies: number, enemies: number }>} */
  const out = {};

  for (const own of matches) {
    const matchId = String(own?.matchId || "");
    if (!matchId) {
      continue;
    }

    /** @type {SquadMember[]} */
    const members = [];
    for (const member of indexed) {
      const self = member.id === playerId;
      // Bakilan oyuncunun satiri her zaman kendi listesindeki satirdir; kadro
      // onbelleginde olmasa bile (ornek: ilk acilis) listeye girer.
      const row = self ? own : member.byMatch.get(matchId);
      if (!row) {
        continue;
      }
      members.push({
        id: member.id,
        name: member.name,
        avatar: member.avatar,
        self,
        team: self || sameTeam(own, row) ? "ally" : "enemy",
        hero: String(row.hero || ""),
        role: String(row.role || ""),
        side: String(row.side || ""),
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
        performanceRank: member.rankByMatch.get(matchId) || null,
      });
    }

    // Bakilan oyuncu kadroda degilse (eski/eksik veri) yine de listede olsun.
    if (!members.some((row) => row.self)) {
      members.unshift({
        id: playerId,
        name: playerId,
        avatar: "",
        self: true,
        team: "ally",
        hero: String(own.hero || ""),
        role: String(own.role || ""),
        side: String(own.side || ""),
        result: String(own.result || ""),
        kills: Number(own.kills || 0),
        deaths: Number(own.deaths || 0),
        assists: Number(own.assists || 0),
        lastHits: Number(own.lastHits || 0),
        denies: Number(own.denies || 0),
        gpm: Number(own.gpm || 0),
        xpm: Number(own.xpm || 0),
        heroDamage: Number(own.heroDamage || 0),
        heroHealing: Number(own.heroHealing || 0),
        towerDamage: Number(own.towerDamage || 0),
        performanceRank: null,
      });
    }

    // Bakilan oyuncu once, sonra takim arkadaslari, en sonda rakipteki
    // kadro uyeleri — ekranda bu sirayla okunur.
    members.sort(
      (a, b) =>
        Number(b.self) - Number(a.self) ||
        Number(a.team === "enemy") - Number(b.team === "enemy"),
    );

    out[matchId] = {
      members,
      allies: members.filter((row) => row.team === "ally").length,
      enemies: members.filter((row) => row.team === "enemy").length,
    };
  }

  return out;
}

/**
 * Iki satir ayni takimda mi?
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 */
function sameTeam(a, b) {
  if (a?.side && b?.side) {
    return a.side === b.side;
  }
  return String(a?.result || "") === String(b?.result || "");
}
