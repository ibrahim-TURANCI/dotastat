import { heroDisplayName } from "@dotastat/core";
import {
  formatClock,
  formatCompact,
  formatRelativeTime,
} from "../lib/format.js";
import {
  CollapsibleSection,
  EmptyState,
  HeroIcon,
  RankMedal,
} from "./primitives.jsx";
import { DraftAssistant } from "./DraftAssistant.jsx";
import "./LiveMatchPanel.css";

/**
 * Canli mac paneli.
 *
 * Veri GSI'dan gelir: bir arkadas masaustu uygulamasini calistirdiginda kendi
 * bilgisayarindaki Dota, mac durumunu uygulamaya gonderir; uygulama da buluta
 * iletir. Bu yuzden panel yalnizca "GSI kurulmus bir arkadas oyundayken"
 * doludur.
 *
 * Arkadaslardan birinde ayrica Overwolf/DotaPlus varsa RAKIP TAKIMIN
 * pickleri de gelir; GSI canli macta yalnizca kendi oyuncusunu verdigi icin
 * bu bilgi baska turlu alinamiyor. Overwolf'lu kimse yoksa panel eskisi gibi,
 * yalnizca GSI'nin verdigi kadariyla calisir.
 *
 * Katlanabilir ve VARSAYILAN OLARAK KAPALIDIR; canli mac basladiginda
 * uygulama kabugu bunu acar (bkz. App.jsx).
 *
 * @param {Object} props
 * @param {Record<string, any>|null} props.live `/api/live` yaniti
 * @param {boolean} props.loading
 * @param {Error|null} props.error
 * @param {boolean} [props.open]
 * @param {() => void} [props.onToggle]
 */
export function LiveMatchPanel({
  live,
  loading,
  error,
  open = false,
  onToggle = () => {},
}) {
  const frame = (children, right, className = "") => (
    <CollapsibleSection
      title="Canlı Maç"
      subtitle="Game State Integration üzerinden anlık maç durumu"
      open={open}
      onToggle={onToggle}
      right={right}
      className={className}
    >
      {children}
    </CollapsibleSection>
  );

  if (loading && !live) {
    return frame(<p className="muted">Canlı maç aranıyor…</p>);
  }

  if (error) {
    return frame(
      <EmptyState title="Canlı maç bilgisi alınamadı" detail={error.message} />,
    );
  }

  if (!live?.active) {
    return frame(
      <EmptyState
        title="Şu anda canlı maç yok"
        detail="Arkadaşlardan biri GSI kurulu masaüstü uygulamasıyla oyuna girdiğinde maç burada belirir."
      />,
    );
  }

  const advice = live.draftAdvice;

  return frame(
    <>
      <div className="live-scoreboard">
        <TeamScore
          side="radiant"
          score={live.score?.radiant}
          mine={live.myTeam === "radiant"}
        />
        <div className="live-clock">
          <strong>{formatClock(live.gameTime)}</strong>
          <span className="muted micro">{phaseLabel(live.phase)}</span>
        </div>
        <TeamScore
          side="dire"
          score={live.score?.dire}
          mine={live.myTeam === "dire"}
        />
      </div>

      <div className="live-teams">
        <TeamColumn
          title="Radiant"
          side="radiant"
          players={live.radiantPlayers}
          mine={live.myTeam === "radiant"}
        />
        <TeamColumn
          title="Dire"
          side="dire"
          players={live.direPlayers}
          mine={live.myTeam === "dire"}
        />
      </div>

      {advice?.visible ? (
        <DraftAssistant advice={advice} />
      ) : (
        <p className="muted micro draft-done-note">
          Draft tamamlandı — pick asistanı kapatıldı.
        </p>
      )}
    </>,
    <>
      <span className="chip good">Canlı</span>
      {live.overwolf ? (
        <span
          className="chip"
          title="Rakip takımın pickleri ve rank bilgisi Overwolf/DotaPlus çalıştıran bir arkadaştan geliyor. GSI canlı maçta yalnızca kendi oyuncusunu verir."
        >
          + Overwolf
        </span>
      ) : null}
      {live.contributorCount > 1 ? (
        <span
          className="chip"
          title="Bu maçın verisi birden fazla kurulumdan birleştiriliyor."
        >
          {live.contributorCount} kaynak
        </span>
      ) : null}
      <span className="muted micro">
        güncellendi: {formatRelativeTime(live.updatedAt)}
      </span>
    </>,
    "live-section",
  );
}

/**
 * @param {{ side: string, score: number, mine: boolean }} props
 */
function TeamScore({ side, score, mine }) {
  return (
    <div className={"team-score " + side + (mine ? " mine" : "")}>
      <span className="muted micro">
        {side === "radiant" ? "Radiant" : "Dire"}
        {mine ? " · bizim taraf" : ""}
      </span>
      <strong>{Number(score || 0)}</strong>
    </div>
  );
}

/**
 * @param {{ title: string, side: string, players: Array<Record<string, any>>, mine: boolean }} props
 */
function TeamColumn({ title, side, players, mine }) {
  // Slot sirasi sabit tutulur: kaynaklar farkli siralarda gelebiliyor ve
  // satirlar her yoklamada yer degistirirse liste okunamaz hale geliyor.
  const rows = [...(players || [])].sort(
    (a, b) => (Number(a.slot) || 99) - (Number(b.slot) || 99),
  );

  return (
    <div className={"team-column " + side}>
      <h3 className="team-column-title">
        {title}
        {mine ? <span className="chip accent">bizim taraf</span> : null}
      </h3>

      {rows.length ? (
        <ul className="live-player-list">
          {rows.map((player, index) => (
            <LivePlayerRow key={rowKey(player, index)} player={player} />
          ))}
        </ul>
      ) : (
        <p className="muted micro">Oyuncu verisi gelmedi.</p>
      )}
    </div>
  );
}

/**
 * Satir anahtari.
 *
 * Overwolf'tan gelen rakip satirlarinda kimlik YOKTUR (ranked'da Dota isim ve
 * steamId'yi gizler), bu yuzden steamId'ye dayanan anahtar hepsini ayni sepete
 * atardi. Once kimlik, sonra slot, en sonda sira numarasi denenir.
 *
 * @param {Record<string, any>} player
 * @param {number} index
 */
function rowKey(player, index) {
  return (
    player.steamId ||
    player.accountId ||
    (player.team && player.slot ? player.team + ":" + player.slot : "") ||
    player.hero ||
    "slot-" + index
  );
}

/**
 * Canli mac oyuncu satiri.
 *
 * Iki tur satir vardir ve ikisi de gecerlidir:
 *   - GSI'li satir  : kimlik + KDA + net worth tam.
 *   - Overwolf satiri: yalnizca hero ve rank; kimlik ranked'da gizlidir.
 *
 * Bu yuzden olmayan alanlar "0" olarak degil, HIC cizilmez — yoksa rakip
 * takimin tamami 0/0/0 gorunur ve gercek bir bilgiymis gibi okunur.
 *
 * @param {{ player: Record<string, any> }} props
 */
function LivePlayerRow({ player }) {
  const hasStats =
    Number.isFinite(Number(player.kills)) &&
    Number.isFinite(Number(player.deaths)) &&
    Number.isFinite(Number(player.assists));
  const rank = player.rank || player.roster?.rank || null;
  const name = player.roster?.name || player.name || "";
  const pending = player.heroConfirmed === false;

  return (
    <li className={"live-player" + (player.roster ? " known" : "")}>
      <HeroIcon hero={player.hero} size={32} />
      <div className="live-player-text">
        <strong>
          {name || (
            <span className="muted">
              {player.slot ? "Slot " + player.slot : "Bilinmiyor"}
            </span>
          )}
        </strong>
        <span className="muted micro">
          {heroDisplayName(player.hero) || "hero seçilmedi"}
          {pending ? " (seçiliyor)" : ""}
          {player.level ? " · sv " + player.level : ""}
        </span>
      </div>
      <div className="live-player-stats">
        {hasStats ? (
          <>
            <span className="mono">
              {player.kills}/{player.deaths}/{player.assists}
            </span>
            <span className="muted micro">
              {formatCompact(player.netWorth)} net
            </span>
          </>
        ) : rank ? (
          <RankMedal rank={rank} size={26} />
        ) : (
          <span className="muted micro">veri yok</span>
        )}
      </div>
    </li>
  );
}

/**
 * GSI faz kodunu okunabilir hale getirir.
 * @param {string} phase
 * @returns {string}
 */
function phaseLabel(phase) {
  const value = String(phase || "").toUpperCase();
  if (value.includes("HERO_SELECTION")) {
    return "Hero seçimi";
  }
  if (value.includes("STRATEGY_TIME")) {
    return "Strateji süresi";
  }
  if (value.includes("PRE_GAME")) {
    return "Maç öncesi";
  }
  if (value.includes("GAME_IN_PROGRESS")) {
    return "Maç sürüyor";
  }
  if (value.includes("POST_GAME")) {
    return "Maç bitti";
  }
  return "Bilinmiyor";
}
