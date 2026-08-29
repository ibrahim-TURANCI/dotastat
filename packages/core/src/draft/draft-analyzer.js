import heroProfiles from "../data/hero-profiles.js";

function normalizeHeroName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^npc_dota_hero_/, "")
    .replace(/\s+/g, "_");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const FALLBACK_DRAFT_PROFILES = {
  magnataur: {
    draft: {
      teamSynergy: 9,
      comboPotential: 9,
      laneSynergy: 7,
      tempo: 7,
      teamfight: 8,
      pushPotential: 4,
      saveMechanics: 2,
      catchPotential: 8,
      scaling: 6,
      earlyGame: 6,
      midGame: 8,
      lateGame: 6,
      synergyTags: ["melee_carry_enable", "aoe_control", "initiator"],
      comboWithHeroes: [
        "juggernaut",
        "phantom_assassin",
        "faceless_void",
        "sven",
      ],
      itemBias: {
        core: 6,
        support: 2,
        situational: 8,
      },
    },
  },
  chen: {
    draft: {
      teamSynergy: 8,
      comboPotential: 6,
      laneSynergy: 8,
      tempo: 9,
      teamfight: 6,
      pushPotential: 10,
      saveMechanics: 6,
      catchPotential: 5,
      scaling: 4,
      earlyGame: 9,
      midGame: 7,
      lateGame: 4,
      synergyTags: ["push_summon", "lane_domination", "save_support"],
      comboWithHeroes: ["lycan", "beastmaster", "death_prophet"],
      itemBias: {
        core: 2,
        support: 8,
        situational: 7,
      },
    },
  },
};

const HERO_ALIASES = {
  magnus: "magnataur",
};

function getDraftHeroProfile(heroName) {
  const normalized = normalizeHeroName(heroName);
  const key = HERO_ALIASES[normalized] || normalized;
  if (!key) {
    return null;
  }
  return heroProfiles[key] || FALLBACK_DRAFT_PROFILES[key] || null;
}

function emptyDraftMetrics() {
  return {
    teamSynergy: 5,
    comboPotential: 5,
    laneSynergy: 5,
    tempo: 5,
    teamfight: 5,
    pushPotential: 5,
    saveMechanics: 3,
    catchPotential: 5,
    scaling: 5,
    earlyGame: 5,
    midGame: 5,
    lateGame: 5,
    synergyTags: [],
    comboWithHeroes: [],
    itemBias: {
      core: 5,
      support: 5,
      situational: 5,
    },
  };
}

function mergeMetrics(base, patch) {
  const output = {
    ...base,
    ...(patch || {}),
    itemBias: {
      ...base.itemBias,
      ...((patch || {}).itemBias || {}),
    },
  };

  for (const key of [
    "teamSynergy",
    "comboPotential",
    "laneSynergy",
    "tempo",
    "teamfight",
    "pushPotential",
    "saveMechanics",
    "catchPotential",
    "scaling",
    "earlyGame",
    "midGame",
    "lateGame",
  ]) {
    output[key] = clamp(Number(output[key] || 0), 1, 10);
  }

  output.synergyTags = Array.from(
    new Set(
      (output.synergyTags || [])
        .map((x) => String(x || "").trim())
        .filter(Boolean),
    ),
  );
  output.comboWithHeroes = Array.from(
    new Set(
      (output.comboWithHeroes || [])
        .map((x) => normalizeHeroName(x))
        .filter(Boolean),
    ),
  );

  output.itemBias = {
    core: clamp(Number(output.itemBias.core || 0), 1, 10),
    support: clamp(Number(output.itemBias.support || 0), 1, 10),
    situational: clamp(Number(output.itemBias.situational || 0), 1, 10),
  };

  return output;
}

function getDraftMetrics(heroName) {
  const profile = getDraftHeroProfile(heroName);
  if (!profile?.draft) {
    return emptyDraftMetrics();
  }
  return mergeMetrics(emptyDraftMetrics(), profile.draft);
}

function summarizeTeamDraft(teamHeroes = []) {
  const heroes = (teamHeroes || [])
    .map((x) => normalizeHeroName(x))
    .filter(Boolean);
  if (!heroes.length) {
    return {
      count: 0,
      avg: emptyDraftMetrics(),
      heroes: [],
      tags: {},
    };
  }

  const sum = {
    teamSynergy: 0,
    comboPotential: 0,
    laneSynergy: 0,
    tempo: 0,
    teamfight: 0,
    pushPotential: 0,
    saveMechanics: 0,
    catchPotential: 0,
    scaling: 0,
    earlyGame: 0,
    midGame: 0,
    lateGame: 0,
  };
  const tags = {};

  for (const hero of heroes) {
    const m = getDraftMetrics(hero);
    sum.teamSynergy += m.teamSynergy;
    sum.comboPotential += m.comboPotential;
    sum.laneSynergy += m.laneSynergy;
    sum.tempo += m.tempo;
    sum.teamfight += m.teamfight;
    sum.pushPotential += m.pushPotential;
    sum.saveMechanics += m.saveMechanics;
    sum.catchPotential += m.catchPotential;
    sum.scaling += m.scaling;
    sum.earlyGame += m.earlyGame;
    sum.midGame += m.midGame;
    sum.lateGame += m.lateGame;

    for (const tag of m.synergyTags || []) {
      tags[tag] = Number(tags[tag] || 0) + 1;
    }
  }

  const count = heroes.length;
  const avg = {
    ...sum,
    teamSynergy: Number((sum.teamSynergy / count).toFixed(2)),
    comboPotential: Number((sum.comboPotential / count).toFixed(2)),
    laneSynergy: Number((sum.laneSynergy / count).toFixed(2)),
    tempo: Number((sum.tempo / count).toFixed(2)),
    teamfight: Number((sum.teamfight / count).toFixed(2)),
    pushPotential: Number((sum.pushPotential / count).toFixed(2)),
    saveMechanics: Number((sum.saveMechanics / count).toFixed(2)),
    catchPotential: Number((sum.catchPotential / count).toFixed(2)),
    scaling: Number((sum.scaling / count).toFixed(2)),
    earlyGame: Number((sum.earlyGame / count).toFixed(2)),
    midGame: Number((sum.midGame / count).toFixed(2)),
    lateGame: Number((sum.lateGame / count).toFixed(2)),
    synergyTags: Object.keys(tags),
    comboWithHeroes: [],
    itemBias: {
      core: 5,
      support: 5,
      situational: 5,
    },
  };

  return {
    count,
    avg,
    heroes,
    tags,
  };
}

function scoreDraftPick({ candidateHero, teamHeroes = [], enemyHeroes = [] }) {
  const candidate = normalizeHeroName(candidateHero);
  if (!candidate) {
    return {
      score: 0,
      reasons: [],
      draftMetrics: emptyDraftMetrics(),
    };
  }

  const ownTeam = teamHeroes.map((x) => normalizeHeroName(x)).filter(Boolean);
  const enemies = enemyHeroes.map((x) => normalizeHeroName(x)).filter(Boolean);
  const ownSummary = summarizeTeamDraft(ownTeam);
  const enemySummary = summarizeTeamDraft(enemies);
  const draft = getDraftMetrics(candidate);

  let score = 0;
  const reasons = [];

  const addNeed = (
    label,
    candidateValue,
    teamValue,
    target = 6.5,
    weight = 3,
  ) => {
    const need = Math.max(0, target - Number(teamValue || 0));
    if (!need) {
      return;
    }
    const gain = (Number(candidateValue || 0) - 5) * need * weight;
    if (gain > 0) {
      score += gain;
      reasons.push(`${label} ihtiyacını tamamlıyor`);
    }
  };

  addNeed("Teamfight", draft.teamfight, ownSummary.avg.teamfight, 7, 2.6);
  addNeed("Push", draft.pushPotential, ownSummary.avg.pushPotential, 6.4, 2.2);
  addNeed(
    "Catch",
    draft.catchPotential,
    ownSummary.avg.catchPotential,
    6.2,
    2.2,
  );
  addNeed("Save", draft.saveMechanics, ownSummary.avg.saveMechanics, 5.5, 1.8);
  addNeed("Tempo", draft.tempo, ownSummary.avg.tempo, 6.5, 2.1);
  addNeed("Scaling", draft.scaling, ownSummary.avg.scaling, 6.5, 2.2);

  const allySet = new Set(ownTeam);
  let comboHits = 0;
  for (const partner of draft.comboWithHeroes || []) {
    if (allySet.has(partner)) {
      comboHits += 1;
    }
  }
  if (comboHits > 0) {
    const comboScore = comboHits * 18;
    score += comboScore;
    reasons.push(`Combo potansiyeli: ${comboHits} uyumlu kahraman`);
  }

  if ((draft.synergyTags || []).includes("melee_carry_enable")) {
    const meleeCoreCount = ownTeam
      .map((hero) => getDraftHeroProfile(hero))
      .filter(
        (profile) =>
          (profile?.roles || []).includes("carry") &&
          (profile?.draft?.synergyTags || []).includes("melee_core"),
      ).length;
    if (meleeCoreCount > 0) {
      score += 16;
      reasons.push("Melee carry ile yüksek sinerji");
    }
  }

  if ((draft.synergyTags || []).includes("vacuum_combo")) {
    const hasAoeFollowup = ownTeam.some((hero) => {
      const metrics = getDraftMetrics(hero);
      return (
        (metrics.synergyTags || []).includes("aoe_control") ||
        (metrics.synergyTags || []).includes("burst_magic")
      );
    });
    if (hasAoeFollowup) {
      score += 14;
      reasons.push("Vacuum benzeri AoE combo penceresi güçlü");
    }
  }

  if ((draft.synergyTags || []).includes("chrono_setup")) {
    const hasRangedBurst = ownTeam.some((hero) => {
      const profile = getDraftHeroProfile(hero);
      if (!profile) {
        return false;
      }
      return (
        (profile.draft?.synergyTags || []).includes("followup_burst") ||
        Number(profile.tags?.nuker || 0) >= 7
      );
    });
    if (hasRangedBurst) {
      score += 16;
      reasons.push("Chronosphere + ranged burst sinerjisi mevcut");
    }
  }

  if (
    Number(enemySummary.avg.pushPotential || 0) >= 6.8 &&
    Number(draft.teamfight || 0) >= 7
  ) {
    score += 8;
    reasons.push("Rakibin push temposuna karşı teamfight cevabı güçlü");
  }

  return {
    score: Math.round(score),
    reasons: Array.from(new Set(reasons)).slice(0, 4),
    draftMetrics: draft,
  };
}

export {
  getDraftHeroProfile,
  getDraftMetrics,
  summarizeTeamDraft,
  scoreDraftPick,
};
