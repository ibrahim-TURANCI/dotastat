import { ROLE_SHORT_LABELS } from "@dotastat/core";
import { formatPercent, formatRelativeTime } from "../lib/format.js";
import { FormStrip, HeroIcon, RankMedal, TrendBadge } from "./primitives.jsx";
import "./PlayerCard.css";

/**
 * Oyuncu Degerlendirme ekranindaki tek kart.
 *
 * NOT: "Potansiyel" ve "Performance Rank" degerleri GERCEK MMR DEGILDIR;
 * oyuncunun hangi seviyede oynadigina dair tahmindir. Kart bunu her zaman
 * acikca yazar.
 *
 * @param {Object} props
 * @param {Record<string, any>} props.card
 * @param {boolean} props.selected
 * @param {(id: string) => void} props.onSelect
 * @param {boolean} [props.live] Oyuncu su an canli macta mi
 */
export function PlayerCard({ card, selected, onSelect, live = false }) {
  const potential = card.effectivePotential || {};
  const form = card.form || {};
  const hasData = card.hasData !== false && Number(form.matches || 0) > 0;

  return (
    <button
      type="button"
      className={
        "player-card" + (selected ? " selected" : "") + (live ? " live" : "")
      }
      onClick={() => onSelect(card.id)}
      aria-pressed={selected}
    >
      <div className="player-card-top">
        <div className="player-card-identity">
          {card.avatar ? (
            <img className="player-avatar" src={card.avatar} alt={card.name} />
          ) : (
            <span className="player-avatar placeholder">
              {String(card.name || "?")
                .slice(0, 1)
                .toUpperCase()}
            </span>
          )}
          <div>
            <strong className="player-name">{card.name}</strong>
            <div className="row" style={{ gap: 6, marginTop: 3 }}>
              {card.primaryRole ? (
                <span className="chip accent">
                  {ROLE_SHORT_LABELS[card.primaryRole] || card.primaryRole}
                </span>
              ) : null}
              {live ? <span className="chip good">Canlı maçta</span> : null}
            </div>
          </div>
        </div>
        <RankMedal rank={card.rank} size={38} />
      </div>

      {hasData ? (
        <>
          <div className="player-card-potential">
            <span className="muted">Tahmini seviye</span>
            <strong>
              {potential.min || 0} – {potential.max || 0}
            </strong>
            <span className="muted micro">gerçek MMR değil</span>
          </div>

          <div className="player-card-form">
            <FormStrip form={form.form || []} />
            <span className="muted">
              {form.wins || 0}/{form.matches || 0} ·{" "}
              {formatPercent(form.winRate)}
            </span>
            <TrendBadge trend={form.trend} />
          </div>

          <div className="player-card-heroes">
            {(card.topHeroes || []).slice(0, 5).map((row) => (
              <HeroIcon
                key={row.hero}
                hero={row.hero}
                size={26}
                title={
                  row.hero +
                  " · " +
                  row.matches +
                  " maç · " +
                  formatPercent(row.winRate)
                }
              />
            ))}
            {!(card.topHeroes || []).length ? (
              <span className="muted micro">hero verisi yok</span>
            ) : null}
          </div>

          <div className="player-card-foot muted micro">
            güncellendi: {formatRelativeTime(card.fetchedAt)}
          </div>
        </>
      ) : card.historyUnavailable ? (
        // Bekleyerek gelmeyecek bir durum: oyuncu Dota'da mac verisini
        // gizlemis. Ne OpenDota ne Stratz mac listesi verebiliyor.
        //
        // Ama KALICI da degil: ayar acilinca "Yenile" bunu yeniden sorar
        // (bkz. player-data-service -> HISTORY_RECHECK_MS), bu yuzden ne
        // yapilacagi burada yaziyor.
        <div className="player-card-pending muted">
          Maç geçmişi gizli. Dota 2 → Ayarlar → Seçenekler → Gelişmiş
          Seçenekler'den <strong>“Maç Verilerini Herkese Açık Yap”</strong> açık
          olmalı. Açtıysan <strong>“Yenile”</strong>ye bas.
        </div>
      ) : (
        <div className="player-card-pending muted">
          Maç verisi henüz alınmadı. “Yenile”ye bas.
        </div>
      )}
    </button>
  );
}
