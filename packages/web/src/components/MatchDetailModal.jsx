import { useEffect } from "react";
import {
  heroDisplayName,
  approximateMmrFromRank,
  resolveRankTier,
} from "@dotastat/core";
import { api } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import {
  formatClock,
  formatCompact,
  formatKda,
  formatRelativeTime,
} from "../lib/format.js";
import { DeltaArrow, HeroIcon, RankMedal, RoleBadge } from "./primitives.jsx";
import "./LiveMatchPanel.css";
import "./MatchDetailModal.css";

/** Bir takimdaki oyuncu sayisi. */
const TEAM_SIZE = 5;

/** Sunucunun hata kodlari -> ekranda gorunen aciklama. */
const DETAIL_ERRORS = {
  "mac-henuz-yok":
    "Kaynak bu maçın tam verisini henüz yayınlamadı; birkaç dakika sonra tekrar dene.",
  "mac-kadroda-degil": "Bu maç kadronun maç kayıtlarında bulunamadı.",
};

/**
 * Son Maclar satirina tiklaninca acilan mac detayi.
 *
 * Tasarim canli mac panelini izler (skor seridi + iki takim tablosu) ki iki
 * ekran ayni sekilde okunsun.
 *
 * IKI KATMAN:
 *   1. Aninda: kadronun onbellekteki mac kayitlarindan kurulan gorunum (bkz.
 *      core/players/match-squads.js). Ag istegi yok.
 *   2. Pencere acilinca: macin TAM kadrosu (`/api/matches/:id`) — on oyuncu,
 *      takim skoru ve herkes icin Performance Rank. Sunucu maci bir kez
 *      ceker ve suresiz onbellege yazar; ayni mac bir daha kaynaga gitmez.
 * Ikinci katman gelmezse (kaynak maci henuz yayinlamadi, limit) ilki kalir.
 *
 * @param {{
 *   match: Record<string, any>,
 *   accountId?: string,
 *   squad?: { members: Array<Record<string, any>> }|null,
 *   evaluation?: Record<string, any>|null,
 *   mmrChange?: { delta: number, mmr: number }|null,
 *   role?: string,
 *   onClose: () => void
 * }} props
 */
export function MatchDetailModal({
  match,
  accountId = "",
  squad,
  evaluation,
  mmrChange,
  role,
  onClose,
}) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const full = useAsyncData(() => api.match(match.matchId), {
    deps: [match.matchId],
  });
  const detail = full.data?.match || null;

  const win = match.result === "win";

  // Bizim taraf: tam veride hesabimizin satirindan, yoksa kayittaki taraftan,
  // o da yoksa sonuctan (kazanan taraf biliniyorsa) cikar.
  const ownFull = detail
    ? detail.players.find((row) => row.accountId === String(accountId))
    : null;
  const ourSide =
    ownFull?.side ||
    (match.side === "radiant" || match.side === "dire" ? match.side : "") ||
    (detail ? (detail.radiantWin === win ? "radiant" : "dire") : "");
  const theirSide = ourSide ? (ourSide === "radiant" ? "dire" : "radiant") : "";
  const sideLabel = (side, fallback) =>
    side === "radiant" ? "Radiant" : side === "dire" ? "Dire" : fallback;

  let allies;
  let enemies;
  if (detail) {
    const toRow = (row) => {
      const self = row.accountId && row.accountId === String(accountId);
      return {
        ...row,
        id: row.accountId || "slot-" + row.slot,
        self,
        known: Boolean(row.rosterId),
        name: row.name || (row.anonymous ? "Anonim oyuncu" : ""),
        // PR sunucudan, TAKIM DAGILIMIYLA hesaplanmis haliyle gelir; mac
        // icindeki on deger ayni pozisyon dagilimina dayansin diye burada
        // ezilmez.
      };
    };
    allies = detail.players.filter((row) => row.side === ourSide).map(toRow);
    enemies = detail.players.filter((row) => row.side !== ourSide).map(toRow);
  } else {
    const members = squad?.members?.length
      ? squad.members
      : [{ ...match, self: true, team: "ally", name: "", id: "self" }];
    const mark = (row) => ({ ...row, known: true });
    allies = members.filter((row) => row.team !== "enemy").map(mark);
    enemies = members.filter((row) => row.team === "enemy").map(mark);
  }

  const ourScore = detail
    ? ourSide === "radiant"
      ? detail.radiantScore
      : detail.direScore
    : null;
  const theirScore = detail
    ? ourSide === "radiant"
      ? detail.direScore
      : detail.radiantScore
    : null;

  const averageTier = Number(detail?.averageRankTier || match.averageRankTier);
  const averageRank = averageTier > 0 ? resolveRankTier(averageTier) : null;
  const teamKills = Number(ourScore ?? match.teamKills);
  const participation =
    teamKills > 0
      ? Math.round(
          ((Number(match.kills || 0) + Number(match.assists || 0)) /
            teamKills) *
            100,
        )
      : null;
  // Tam veri geldiyse rol, PR ve aciklama PENCERENIN KENDI degerlendirmesinden
  // (takim dagilimi + macin resmi seviyesi) okunur; Son Maclar'daki tek
  // oyunculuk tahmin ("Pos 1", farkli mac ortalamasi) burada gosterilmez.
  const shown = ownFull || evaluation;
  const effectiveRole = ownFull?.role || role || match.role || "";

  return (
    <div
      className="match-detail-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="match-detail"
        role="dialog"
        aria-modal="true"
        aria-label={"Maç " + match.matchId}
      >
        <header className="match-detail-head">
          <div className="row" style={{ gap: 10 }}>
            <HeroIcon hero={match.hero} size={36} />
            <div className="stack" style={{ gap: 2 }}>
              <strong>
                {heroDisplayName(match.hero) || "Bilinmeyen hero"}
                <span className={"chip " + (win ? "good" : "bad")}>
                  {win ? "Galibiyet" : "Mağlubiyet"}
                </span>
              </strong>
              <span className="muted micro match-detail-meta">
                Maç #{match.matchId} · {formatRelativeTime(match.startedAt)}
                {effectiveRole ? (
                  <RoleBadge role={effectiveRole} small />
                ) : null}
              </span>
            </div>
          </div>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Kapat
          </button>
        </header>

        <div className="live-scoreboard">
          <div className={"team-score " + (ourSide || "radiant") + " mine"}>
            <span className="muted micro">
              {sideLabel(ourSide, "Bizim takım")} · bizim taraf ·{" "}
              {win ? "kazandı" : "kaybetti"}
            </span>
            <strong
              className={ourScore === null ? "match-detail-result" : undefined}
            >
              {ourScore ?? (win ? "Kazandı" : "Kaybetti")}
            </strong>
          </div>
          <div className="live-clock">
            <strong>{formatClock(match.durationSeconds)}</strong>
            <span className="muted micro">maç süresi</span>
          </div>
          <div className={"team-score " + (theirSide || "dire")}>
            <span className="muted micro">
              {sideLabel(theirSide, "Rakip")} · {win ? "kaybetti" : "kazandı"}
            </span>
            <strong
              className={
                theirScore === null ? "match-detail-result" : undefined
              }
            >
              {theirScore ?? (win ? "Kaybetti" : "Kazandı")}
            </strong>
          </div>
        </div>

        {full.loading ? (
          <p className="muted micro match-detail-note">
            Maçın tam kadrosu yükleniyor…
          </p>
        ) : null}

        <div className="live-teams">
          <SquadColumn
            title={sideLabel(ourSide, "Bizim takım")}
            side={ourSide || "radiant"}
            rows={allies}
            complete={Boolean(detail)}
            mine
          />
          <SquadColumn
            title={sideLabel(theirSide, "Rakip takım")}
            side={theirSide || "dire"}
            rows={enemies}
            complete={Boolean(detail)}
          />
        </div>

        <div className="match-detail-facts">
          {averageRank ? (
            <Fact
              label="Maç seviyesi"
              value={<RankMedal rank={averageRank} size={28} />}
              // Madalya adi ikonda zaten gorunuyor (uzerine gelince de
              // yaziyor); altta ortalamanin MMR karsiligi yazilir.
              hint={"~" + approximateMmrFromRank(averageRank) + " ortalama"}
            />
          ) : null}
          {ownFull?.performanceRank || evaluation?.performanceRank ? (
            <Fact
              label="Performance Rank"
              value={ownFull?.performanceRank || evaluation.performanceRank}
              hint={
                ownFull
                  ? "maç içi karşılaştırma · gerçek MMR değil"
                  : "gerçek MMR değil"
              }
            />
          ) : null}
          {mmrChange ? (
            <Fact
              label="MMR"
              value={mmrChange.mmr}
              hint={<DeltaArrow value={mmrChange.delta} />}
            />
          ) : null}
          {participation !== null ? (
            <Fact label="Kill katılımı" value={"%" + participation} />
          ) : null}
          <Fact
            label="KDA oranı"
            value={formatKda(match)}
            hint={`${match.kills}/${match.deaths}/${match.assists}`}
          />
          <Fact
            label="GPM / XPM"
            value={`${match.gpm || 0} / ${match.xpm || 0}`}
          />
        </div>

        {shown?.summary ||
        shown?.strengths?.length ||
        shown?.mistakes?.length ? (
          <div className="match-detail-eval">
            {shown.summary ? (
              <p className="eval-summary">{shown.summary}</p>
            ) : null}
            <div className="eval-lists">
              {(shown.strengths || []).length ? (
                <div>
                  <span className="muted micro">İyi giden</span>
                  <ul>
                    {shown.strengths.slice(0, 3).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(shown.mistakes || []).length ? (
                <div>
                  <span className="muted micro">Geliştirilecek</span>
                  <ul>
                    {shown.mistakes.slice(0, 3).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="muted micro match-detail-note">
          {detail
            ? "Performance Rank gerçek MMR değildir. Maç içinde karşılaştırılabilsin diye 10 oyuncunun hepsi maçın ortalama seviyesinden, yalnızca bu maçtaki istatistikleriyle değerlendirilir; Son Maçlar'daki PR oyuncunun kendi profilini taban aldığı için farklı olabilir."
            : full.error
              ? (DETAIL_ERRORS[full.error.code] ||
                  "Maçın tam kadrosu alınamadı.") +
                " Şimdilik kadromuzun önbellekteki kayıtları gösteriliyor."
              : "Kadro dışı oyuncular tam veri gelince görünecek."}
        </p>
      </div>
    </div>
  );
}

/**
 * Bir takimin tablosu. Tam veri yoksa eksik yuvalar "görünmüyor" satiri
 * olarak cizilir; bos satir cizmek o oyuncularin olmadigini soylemek olurdu.
 *
 * @param {{
 *   title: string,
 *   side: string,
 *   rows: Array<Record<string, any>>,
 *   complete?: boolean,
 *   mine?: boolean
 * }} props
 */
function SquadColumn({ title, side, rows, complete = false, mine = false }) {
  const hidden = complete ? 0 : Math.max(0, TEAM_SIZE - rows.length);
  const known = rows.filter((row) => row.known).length;
  return (
    <div className={"team-column " + side}>
      <h3 className="team-column-title">
        {title}
        {mine ? <span className="chip accent">bizim taraf</span> : null}
        {known ? (
          <span className="muted micro">{known} kadro oyuncusu</span>
        ) : null}
      </h3>
      <div className="live-table-wrap">
        <table className="live-table">
          <thead>
            <tr>
              <th>Oyuncu / Hero</th>
              <th>KDA · LH/DN</th>
              <th>GPM / XPM</th>
              <th>Hasar</th>
              <th title="Performance Rank — gerçek MMR değil">PR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.known ? "known" : ""}>
                <td>
                  <div className="live-player-cell">
                    <HeroIcon hero={row.hero} size={30} />
                    <div className="live-player-text">
                      <strong title={row.rank?.label || undefined}>
                        {row.name || "Oyuncu"}
                        {row.self ? (
                          <span className="muted micro"> (bu oyuncu)</span>
                        ) : null}
                      </strong>
                      {/* Hero adi yazilmaz: ikon zaten gosteriyor (adi
                          ikonun ipucunda). Satirda yalnizca pozisyon ve
                          seviye kalir. */}
                      <span className="muted micro">
                        {row.role ? (
                          <>
                            <RoleBadge
                              role={row.role}
                              small
                              title={
                                row.roleSource === "manual"
                                  ? "Oyuncunun elle girdiği pozisyon"
                                  : row.roleSource === "team"
                                    ? "Takım dağılımından tahmin (her pozisyondan bir kişi)"
                                    : undefined
                              }
                            />
                            {row.roleSource === "manual" ? " (elle)" : ""}
                          </>
                        ) : null}
                        {row.level
                          ? (row.role ? " · " : "") + "sv " + row.level
                          : ""}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="live-kda-cell">
                    <span className="mono">
                      {row.kills}/{row.deaths}/{row.assists}
                    </span>
                    <span className="muted micro mono">
                      {Number(row.lastHits || 0)}/{Number(row.denies || 0)}
                    </span>
                  </div>
                </td>
                <td className="mono">
                  {Number(row.gpm || 0)} / {Number(row.xpm || 0)}
                </td>
                <td className="mono">
                  {row.heroDamage ? formatCompact(row.heroDamage) : "—"}
                </td>
                <td className="mono">{row.performanceRank || "—"}</td>
              </tr>
            ))}
            {Array.from({ length: hidden }, (_, index) => (
              <tr key={"hidden-" + index} className="match-detail-hidden">
                <td colSpan={5}>
                  <span className="muted micro">
                    Kadro dışı oyuncu — tam veri bekleniyor
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * @param {{ label: string, value: React.ReactNode, hint?: React.ReactNode }} props
 */
function Fact({ label, value, hint }) {
  return (
    <div className="summary-cell">
      <span className="muted micro">{label}</span>
      <strong>{value}</strong>
      {hint ? <span className="muted micro">{hint}</span> : null}
    </div>
  );
}
