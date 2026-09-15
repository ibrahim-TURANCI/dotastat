import { useEffect, useRef, useState } from "react";
import { heroDisplayName, itemDisplayName, itemIconUrl } from "@dotastat/core";
import "./TeamAnalysis.css";

/**
 * Takim analizi ve takim onerileri.
 *
 * IKI PANEL YAN YANA
 *   Takım Analizi   : alti eksenli radar + sekiz satirlik R/D yuzde tablosu
 *   Takım Önerileri : her taraf icin avantaj listesi ve uc item grubu
 *                     (Core / Support / Duruma Göre)
 *
 * NEDEN IKI TARAF DA CIZILIYOR: rakibin neyi iyi yaptigini gormek, kendi
 * eksigini gormek kadar ise yariyor — "onlar bizden dayanikli" cumlesi bir
 * karar degistirir. Sutunlar HER ZAMAN Radiant solda, Dire sagda durur;
 * "biz/onlar" olarak ciziliyordu ve taraf degistikce tablo yer degistirip
 * okunamaz hale geliyordu.
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

  const radiant = analysis.radiant || {};
  const dire = analysis.dire || {};
  const hasItems =
    (radiant.items?.length || 0) > 0 || (dire.items?.length || 0) > 0;

  return (
    <section className="team-analysis">
      <div className="analysis-panel">
        <header className="analysis-head">
          <h4>Takım Analizi</h4>
          <span className="muted micro">{dataLevelLabel(adviceLevel)}</span>
        </header>

        <div className="radar-layout">
          <div className="radar-chart-wrap">
            <RadarChart
              axes={analysis.radarAxes || []}
              radiant={radiant.bars || {}}
              dire={dire.bars || {}}
            />
            <div className="radar-legend">
              <span className="radar-dot radiant" />
              <span>Radiant</span>
              <span className="radar-dot dire" />
              <span>Dire</span>
            </div>
          </div>

          <table className="radar-table">
            <thead>
              <tr>
                <th />
                <th className="radiant-col">R</th>
                <th className="dire-col">D</th>
              </tr>
            </thead>
            <tbody>
              {(analysis.tableRows || []).map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="radiant-col">
                    {Number(radiant.bars?.[row.key] || 0)}%
                  </td>
                  <td className="dire-col">
                    {Number(dire.bars?.[row.key] || 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="analysis-panel">
        <header className="analysis-head">
          <h4>Takım Önerileri</h4>
          {analysis.note ? (
            <span className="muted micro" title={analysis.note}>
              {myTeam === "dire" ? "Dire" : "Radiant"} tarafındayız
            </span>
          ) : null}
        </header>

        {hasItems || analysis.comparable ? (
          <div className="reco-compare">
            <SideColumn
              side="radiant"
              title="Radiant Avantajı"
              data={radiant}
            />
            <SideColumn side="dire" title="Dire Avantajı" data={dire} />
          </div>
        ) : (
          <p className="muted micro">{analysis.note}</p>
        )}
      </div>
    </section>
  );
}

/**
 * Bir tarafin avantaj listesi ve item onerileri.
 *
 * @param {{
 *   side: "radiant"|"dire",
 *   title: string,
 *   data: Record<string, any>
 * }} props
 */
function SideColumn({ side, title, data }) {
  const advantages = data.advantages || [];
  const threats = data.threats || [];
  const groups = groupItems(data.items || []);

  return (
    <div className="reco-col">
      <h5 className={side === "radiant" ? "radiant-col" : "dire-col"}>
        {title}
      </h5>

      {/*
        Onerinin GEREKCESI listenin ustunde durur. Yalnizca item kutulari
        gosterilseydi "neden bu item" sorusu ancak kutuya gelince cevaplanirdi
        ve maç sirasinda kimse fareyle kutu kutu gezmiyor.
      */}
      {threats.length ? (
        <div className="threat-row">
          <span className="muted micro">Karşıda:</span>
          {threats.map((threat) => (
            <span
              key={threat.key}
              className="threat-chip"
              title={threat.heroes.map(heroDisplayName).join(", ")}
            >
              {threat.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="advantage-list">
        {advantages.length ? (
          advantages.map((row) => (
            <div key={row.key} className="advantage-item">
              <span className={"advantage-dot " + side} />
              Daha iyi {row.label.toLocaleLowerCase("tr")}
              <span className="muted micro"> (+{row.diff})</span>
            </div>
          ))
        ) : (
          <div className="advantage-item">
            <span className="advantage-dot" />
            <span className="muted">Belirgin avantaj yok</span>
          </div>
        )}
      </div>

      <div className="reco-stack">
        <RecoGroup label="Core" items={groups.core} />
        <RecoGroup label="Support" items={groups.support} />
        <RecoGroup label="Duruma Göre" items={groups.situational} />
      </div>
    </div>
  );
}

/** Bir grupta gosterilen en fazla item (sabit izgara). */
const RECO_SLOTS = 5;

/**
 * Tek bir oneri grubu (sabit bes yuva).
 * @param {{ label: string, items: Array<Record<string, any>> }} props
 */
function RecoGroup({ label, items }) {
  return (
    <div className="reco-group">
      <div className="reco-label">{label}</div>
      <div className="reco-items">
        {Array.from({ length: RECO_SLOTS }, (_, index) => {
          const row = items[index];
          if (!row) {
            return <div key={index} className="reco-slot empty" />;
          }
          return <RecoSlot key={row.key} row={row} />;
        })}
      </div>
    </div>
  );
}

/**
 * Tek oneri kutusu; ikon yuklenmezse bas harflere duser.
 * @param {{ row: Record<string, any> }} props
 */
function RecoSlot({ row }) {
  const [failed, setFailed] = useState(false);
  const name = row.name || itemDisplayName(row.key);
  // Kimin alacagi onerinin yarisi: "Pipe al" tek basina eyleme donmuyor.
  const buyers = row.buyerNames?.length
    ? " Alabilir: " + row.buyerNames.join(", ") + "."
    : "";

  return (
    <div className="reco-slot" title={name + " — " + row.reason + buyers}>
      {failed ? (
        <span className="reco-fallback">{name.slice(0, 2).toUpperCase()}</span>
      ) : (
        <img
          src={itemIconUrl(row.key)}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/**
 * Onerileri uc gruba ayirir.
 *
 * Motor "counter" grubunu da uretebiliyor; takim panelinde ayri bir satiri yok
 * ve kaybolmamasi icin duruma gore listesine dusuyor.
 *
 * @param {Array<Record<string, any>>} items
 */
function groupItems(items) {
  const groups = { core: [], support: [], situational: [] };
  for (const row of items) {
    const group = groups[row.group] ? row.group : "situational";
    if (groups[group].length < RECO_SLOTS) {
      groups[group].push(row);
    }
  }
  return groups;
}

/** Radar cizim olcusu (CSS'te genislik ayrica kisitlaniyor). */
const RADAR_SIZE = 320;

/**
 * Iki takimin kompozisyonunu ust uste cizen radar.
 *
 * Canvas kullaniliyor cunku cizim tamamen sayisal: alti eksen, iki cokgen ve
 * izgara halkalari. SVG ile ayni sonuc icin onlarca dugum uretmek gerekirdi ve
 * bu bilesen saniyede bir yeniden ciziliyor.
 *
 * @param {{
 *   axes: Array<{ key: string, label: string }>,
 *   radiant: Record<string, number>,
 *   dire: Record<string, number>
 * }} props
 */
function RadarChart({ axes, radiant, dire }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !axes.length) {
      return;
    }

    // Ekran yogunluguna gore olcekleme: aksi halde retina ekranlarda cizgiler
    // bulanik cikiyor.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = RADAR_SIZE * ratio;
    canvas.height = RADAR_SIZE * ratio;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE);

    const count = axes.length;
    const cx = RADAR_SIZE / 2;
    const cy = RADAR_SIZE / 2;
    // Yaricap, en uzun etiketin disari tasmayacagi kadar kisa tutuldu.
    const maxRadius = RADAR_SIZE * 0.3;
    const labelRadius = RADAR_SIZE * 0.4;
    const step = (2 * Math.PI) / count;
    const angleOf = (index) => -Math.PI / 2 + index * step;
    const pointAt = (radius, index) => {
      const angle = angleOf(index);
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    };

    const traceRing = (radius) => {
      ctx.beginPath();
      for (let index = 0; index < count; index += 1) {
        const [x, y] = pointAt(radius, index);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
    };

    // Izgara halkalari (%25 aralikli).
    for (let level = 1; level <= 4; level += 1) {
      traceRing((maxRadius * level) / 4);
      ctx.strokeStyle =
        level === 4 ? "rgba(148,175,212,0.26)" : "rgba(148,175,212,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Eksen cizgileri.
    for (let index = 0; index < count; index += 1) {
      const [x, y] = pointAt(maxRadius, index);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(148,175,212,0.18)";
      ctx.stroke();
    }

    /**
     * @param {Record<string, number>} bars
     * @param {string} fill
     * @param {string} stroke
     */
    const drawTeam = (bars, fill, stroke) => {
      ctx.beginPath();
      axes.forEach((axis, index) => {
        const value = Math.max(0, Math.min(100, Number(bars?.[axis.key] || 0)));
        const [x, y] = pointAt((maxRadius * value) / 100, index);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();

      axes.forEach((axis, index) => {
        const value = Math.max(0, Math.min(100, Number(bars?.[axis.key] || 0)));
        const [x, y] = pointAt((maxRadius * value) / 100, index);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = stroke;
        ctx.fill();
      });
    };

    drawTeam(radiant, "rgba(41,201,122,0.16)", "#29c97a");
    drawTeam(dire, "rgba(255,93,108,0.14)", "#ff5d6c");

    // Eksen etiketleri; hizalama acidan turer ki yazi cizime binmesin.
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#a3b8d4";
    axes.forEach((axis, index) => {
      const angle = angleOf(index);
      const [x, y] = pointAt(labelRadius, index);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.textAlign =
        Math.abs(cos) < 0.15 ? "center" : cos > 0 ? "left" : "right";
      ctx.textBaseline =
        Math.abs(sin) < 0.15 ? "middle" : sin < 0 ? "bottom" : "top";
      ctx.fillText(axis.label, x, y);
    });
  }, [axes, radiant, dire]);

  return (
    <canvas
      ref={canvasRef}
      className="radar-canvas"
      style={{ width: RADAR_SIZE, height: RADAR_SIZE }}
      role="img"
      aria-label="Takım kompozisyon karşılaştırması"
    />
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
