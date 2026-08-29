import { HeroIcon } from "./primitives.jsx";
import "./DraftAssistant.css";

const STAGE_LABELS = {
  pre: "Pick öncesi",
  active: "Pick sürüyor",
};

/**
 * Draft asistani.
 *
 * Yalnizca `advice.visible` true iken cizilir; pickler tamamlandiginda
 * cekirdek modul `visible: false` dondurur ve panel hic gorunmez.
 *
 * @param {{ advice: Record<string, any> }} props
 */
export function DraftAssistant({ advice }) {
  if (!advice?.visible) {
    return null;
  }

  return (
    <section className="draft-assistant">
      <div className="draft-assistant-head">
        <h3>
          Draft Asistanı
          <span className="chip accent">
            {STAGE_LABELS[advice.stage] || advice.stage}
          </span>
        </h3>
        <div className="row" style={{ gap: 6 }}>
          {advice.knownPlayerCount ? (
            <span className="chip good">
              {advice.knownPlayerCount} tanınan oyuncu
            </span>
          ) : null}
          {advice.bannedHeroes?.length ? (
            <span className="chip">{advice.bannedHeroes.length} ban</span>
          ) : null}
        </div>
      </div>

      {(advice.notes || []).map((note, index) => (
        <p key={index} className="muted micro draft-note">
          {note}
        </p>
      ))}

      {advice.teamHeroes?.length || advice.enemyHeroes?.length ? (
        <div className="draft-picked">
          <PickedRow
            label="Bizim pickler"
            heroes={advice.teamHeroes}
            tone="mine"
          />
          <PickedRow
            label="Rakip pickler"
            heroes={advice.enemyHeroes}
            tone="enemy"
          />
        </div>
      ) : null}

      <div className="draft-blocks">
        {(advice.blocks || []).map((block) => (
          <article key={block.role} className="draft-block">
            <header>
              <strong>{block.roleLabel}</strong>
              {block.player ? (
                <span className="chip accent">{block.player.name}</span>
              ) : (
                <span className="muted micro">oyuncu atanmadı</span>
              )}
            </header>

            <ul className="draft-suggestions">
              {block.suggestions.map((row, index) => (
                <li key={row.hero} className={index === 0 ? "top" : ""}>
                  <HeroIcon hero={row.hero} size={34} />
                  <div className="draft-suggestion-text">
                    <strong>{row.heroName}</strong>
                    <span className="muted micro">
                      {row.reasons.join(" · ") || "genel uyum"}
                    </span>
                  </div>
                  <span className="draft-score" title="Öneri puanı">
                    {row.score}
                  </span>
                </li>
              ))}
              {!block.suggestions.length ? (
                <li className="muted micro">Uygun aday kalmadı.</li>
              ) : null}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * @param {{ label: string, heroes: string[], tone: string }} props
 */
function PickedRow({ label, heroes, tone }) {
  if (!heroes?.length) {
    return null;
  }
  return (
    <div className={"draft-picked-row " + tone}>
      <span className="muted micro">{label}</span>
      <div className="row" style={{ gap: 4 }}>
        {heroes.map((hero) => (
          <HeroIcon key={hero} hero={hero} size={26} />
        ))}
      </div>
    </div>
  );
}
