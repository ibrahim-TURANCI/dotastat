import { itemIconUrl } from "@dotastat/core";
import "./TeamAnalysis.css";

/**
 * Takim analizi ve takim onerileri.
 *
 * NE KADAR KONUSABILIR: analiz, item tavsiyesiyle AYNI kurala tabidir —
 * elde ne kadar veri varsa o kadar iddia edilir. Rakip hero'lar gorunmuyorsa
 * karsilastirma cizilmez, yalnizca kendi kompozisyonumuzun eksikleri
 * soylenir. "Rakipten daha iyiyiz" demek icin rakibi gormek gerekir.
 *
 * @param {Object} props
 * @param {Record<string, any>|null} props.analysis `/api/live` -> teamAnalysis
 * @param {"self"|"heroes"|"full"} [props.adviceLevel]
 * @param {string} [props.myTeam]
 */
export function TeamAnalysis({ analysis, adviceLevel = "self", myTeam }) {
  if (!analysis) {
    return null;
  }

  const { advantages = [], gaps = [], recommendations = [], note } = analysis;
  const sideLabel = myTeam === "dire" ? "Dire" : "Radiant";

  return (
    <section className="team-analysis">
      <header className="team-analysis-head">
        <h4>Takım Analizi</h4>
        <span className="muted micro">
          {sideLabel} · {dataLevelLabel(adviceLevel)}
        </span>
      </header>

      {note ? <p className="muted micro">{note}</p> : null}

      <div className="team-analysis-grid">
        <div>
          <span className="muted micro">Üstün olduğumuz</span>
          {advantages.length ? (
            <ul className="team-analysis-list">
              {advantages.map((row) => (
                <li key={row.key}>
                  <span className="dot good" />
                  Daha iyi {row.label}
                  <span className="muted micro"> (+{row.diff})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted micro">
              {analysis.comparable
                ? "Belirgin üstünlük yok."
                : "Karşılaştırma için rakip hero'lar gerekli."}
            </p>
          )}
        </div>

        <div>
          <span className="muted micro">Eksiğimiz</span>
          {gaps.length ? (
            <ul className="team-analysis-list">
              {gaps.map((row) => (
                <li key={row.key}>
                  <span className="dot bad" />
                  Zayıf {row.label}
                  <span className="muted micro"> ({row.score})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted micro">Belirgin bir eksik görünmüyor.</p>
          )}
        </div>
      </div>

      {recommendations.length ? (
        <div className="team-reco">
          <span className="muted micro">Takım önerileri</span>
          <div className="team-reco-row">
            {recommendations.map((row) => (
              <div
                key={row.key}
                className="team-reco-item"
                title={`${row.name} — ${row.reason}`}
              >
                <img src={itemIconUrl(row.key)} alt={row.name} loading="lazy" />
                <span className="micro">{row.name}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Veri seviyesini kullaniciya acikca yazar; oneriye ne kadar guvenecegini
 * bilmesi icin gerekli.
 *
 * @param {string} level
 * @returns {string}
 */
function dataLevelLabel(level) {
  if (level === "full") {
    return "rakip envanteri görünüyor";
  }
  if (level === "heroes") {
    return "rakip hero'lar biliniyor";
  }
  return "yalnızca kendi verimiz";
}
