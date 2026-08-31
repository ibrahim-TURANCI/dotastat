import { ROLE_SHORT_LABELS } from "@dotastat/core";
import { api } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { formatPercent } from "../lib/format.js";
import {
  EmptyState,
  FormStrip,
  RankMedal,
  SkeletonBlock,
} from "./primitives.jsx";
import "./WeeklyLeaderboard.css";

/**
 * Haftanin Kazanani / Kaybedeni.
 *
 * Siralama TEK BIR OLCUTLE yapilmaz. "Weekly Score" dort seyi birlestirir:
 * gercek MMR degisimi, galibiyet/maglubiyet dengesi, Performance Rank
 * degisimi ve oynanan mac sayisi. Mac sayisi ayni zamanda CARPANDIR — bir
 * mac oynayip kazanan haftanin birincisi olamaz (bkz. core/weekly-score.js).
 *
 * Veri onbellekten uretilir; bu bolum hicbir zaman kendi basina dis kaynaga
 * gitmez. Tazeleme "Oyuncu Degerlendirme" ekranindaki Yenile'dedir.
 */
export function WeeklyLeaderboard() {
  const board = useAsyncData(() => api.weekly());

  if (board.loading) {
    return (
      <section className="section">
        <SectionHead />
        <SkeletonBlock lines={3} height={72} />
      </section>
    );
  }

  if (board.error) {
    return (
      <section className="section">
        <SectionHead />
        <EmptyState
          title="Haftalık tablo alınamadı"
          detail={board.error.message}
          action={
            <button type="button" className="btn small" onClick={board.reload}>
              Tekrar dene
            </button>
          }
        />
      </section>
    );
  }

  const rows = board.data?.rows || [];
  const winner = board.data?.winner;
  const loser = board.data?.loser;

  return (
    <section className="section">
      <SectionHead />

      {winner && loser ? (
        <div className="weekly-podium">
          <HighlightCard row={winner} tone="winner" />
          <HighlightCard row={loser} tone="loser" />
        </div>
      ) : (
        <EmptyState
          title="Bu hafta sıralama çıkmadı"
          detail="Son 7 günde maç oynayan en az iki oyuncu gerekiyor."
        />
      )}

      {rows.length ? <WeeklyTable rows={rows} /> : null}

      <p className="muted micro weekly-note">
        Weekly Score = gerçek MMR değişimi + galibiyet dengesi + Performance
        Rank değişimi; hepsi oynanan maç sayısıyla ağırlıklandırılır. Az maç
        oynayan oyuncunun sonucu tam ağırlık almaz.
      </p>
    </section>
  );
}

function SectionHead() {
  return (
    <div className="section-head">
      <div>
        <h2 className="section-title">Haftanın Kazananı / Kaybedeni</h2>
        <p className="section-subtitle">
          Son 7 gün · MMR değişimi, galibiyet dengesi, Performance Rank değişimi
          ve maç sayısına göre
        </p>
      </div>
    </div>
  );
}

/**
 * Ustteki iki buyuk kart: birinci (yesil cerceve) ve sonuncu (kirmizi).
 *
 * @param {{ row: Record<string, any>, tone: "winner"|"loser" }} props
 */
function HighlightCard({ row, tone }) {
  return (
    <article className={"weekly-card " + tone}>
      <header className="weekly-card-head">
        <span className={"chip " + (tone === "winner" ? "good" : "bad")}>
          {tone === "winner" ? "🏆 Haftanın kazananı" : "💀 Haftanın kaybedeni"}
        </span>
        <span className="weekly-score" title="Weekly Score">
          {row.score}
        </span>
      </header>

      <div className="weekly-card-identity">
        <Avatar row={row} size={54} />
        <div className="weekly-card-name">
          <strong>{row.name}</strong>
          <div className="row" style={{ gap: 6 }}>
            <RankMedal rank={row.rank} size={26} />
            <MmrValue progress={row.mmrProgress} />
            {row.primaryRole ? (
              <span className="chip">
                {ROLE_SHORT_LABELS[row.primaryRole] || row.primaryRole}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="weekly-metrics">
        <Metric
          label="MMR"
          value={<MmrDelta row={row} />}
          hint={MMR_SOURCE_HINTS[row.mmrSource] || ""}
        />
        <Metric
          label="Galibiyet"
          value={
            <span>
              {row.wins}G · {row.losses}M
            </span>
          }
          hint={formatPercent(row.winRate)}
        />
        <Metric
          label="Perf. Rank"
          value={<PerformanceDelta row={row} />}
          hint={row.performanceRank ? "ort. " + row.performanceRank : "—"}
        />
        <Metric
          label="Maç"
          value={<span>{row.matches}</span>}
          hint="son 7 gün"
        />
      </div>

      <FormStrip form={row.form} max={14} />
    </article>
  );
}

/**
 * Alttaki tam liste — kadronun tamami, sirayla.
 *
 * @param {{ rows: Array<Record<string, any>> }} props
 */
function WeeklyTable({ rows }) {
  return (
    <div className="weekly-table-wrap">
      <table className="data-table weekly-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Oyuncu</th>
            <th>MMR</th>
            <th>G / M</th>
            <th>Perf. Rank</th>
            <th>Maç</th>
            <th>Form</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={
                row.ranked ? (row.position === 1 ? "first" : "") : "idle"
              }
            >
              <td className="muted">{row.ranked ? row.position : "—"}</td>
              <td>
                <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <Avatar row={row} size={26} />
                  <span className="weekly-row-name">{row.name}</span>
                  <RankMedal rank={row.rank} size={20} />
                </span>
              </td>
              <td>{row.ranked ? <MmrDelta row={row} /> : <Dash />}</td>
              <td>
                {row.ranked ? (
                  <span>
                    {row.wins} / {row.losses}
                  </span>
                ) : (
                  <Dash />
                )}
              </td>
              <td>{row.ranked ? <PerformanceDelta row={row} /> : <Dash />}</td>
              <td>{row.matches}</td>
              <td>
                {row.ranked ? (
                  <FormStrip form={row.form} max={10} />
                ) : (
                  <span className="muted micro">bu hafta maç yok</span>
                )}
              </td>
              <td>
                {row.ranked ? (
                  <strong className="weekly-row-score">{row.score}</strong>
                ) : (
                  <Dash />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Karttaki tek olcut kutusu.
 *
 * @param {{ label: string, value: React.ReactNode, hint?: string }} props
 */
function Metric({ label, value, hint }) {
  return (
    <div className="weekly-metric">
      <span className="muted micro">{label}</span>
      <strong>{value}</strong>
      {hint ? <span className="muted micro">{hint}</span> : null}
    </div>
  );
}

/** MMR degisiminin nereden geldigi — tahmin ile olculeni karistirmamak icin. */
const MMR_SOURCE_HINTS = {
  measured: "ölçülen",
  partial: "kısmen ölçülen",
  estimated: "maç sonucundan tahmin",
  none: "",
};

/**
 * @param {{ row: Record<string, any> }} props
 */
function MmrDelta({ row }) {
  const delta = Number(row.mmrDelta) || 0;
  const estimated = row.mmrSource !== "measured";
  return (
    <span
      className={"weekly-delta " + (delta >= 0 ? "up" : "down")}
      title={
        estimated
          ? "Bu oyuncunun MMR'ı tam okunamıyor; eksik maçlar maç başına ±25 sayıldı."
          : "Oyundan okunan gerçek MMR değişimi"
      }
    >
      {estimated ? "~" : ""}
      {delta > 0 ? "+" : ""}
      {delta}
    </span>
  );
}

/**
 * @param {{ row: Record<string, any> }} props
 */
function PerformanceDelta({ row }) {
  if (!row.hasBaseline) {
    return (
      <span
        className="muted micro"
        title="Kıyaslanacak önceki dönem verisi yok"
      >
        yeni
      </span>
    );
  }
  const delta = Number(row.performanceDelta) || 0;
  return (
    <span
      className={"weekly-delta " + (delta >= 0 ? "up" : "down")}
      title={"Önceki döneme göre: " + row.baselinePerformanceRank}
    >
      {delta > 0 ? "+" : ""}
      {delta}
    </span>
  );
}

/**
 * Kartta madalyanin yanindaki MMR. Olculemeyen oyuncuda "~" ile gosterilir.
 *
 * @param {{ progress?: { mmr: number, approximate: boolean } }} props
 */
function MmrValue({ progress }) {
  if (!progress) {
    return null;
  }
  return (
    <span
      className="muted micro"
      title={
        progress.approximate
          ? "Gerçek MMR okunamıyor; madalyadan hesaplanan yaklaşık değer."
          : "Oyundan okunan gerçek MMR"
      }
    >
      {progress.approximate ? "~" : ""}
      {progress.mmr} MMR
    </span>
  );
}

/**
 * @param {{ row: Record<string, any>, size: number }} props
 */
function Avatar({ row, size }) {
  if (row.avatar) {
    return (
      <img
        className="player-avatar"
        src={row.avatar}
        alt={row.name}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="player-avatar placeholder"
      style={{ width: size, height: size, fontSize: Math.round(size / 2.4) }}
    >
      {String(row.name || "?")
        .slice(0, 1)
        .toUpperCase()}
    </span>
  );
}

function Dash() {
  return <span className="muted micro">—</span>;
}
