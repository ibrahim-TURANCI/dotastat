import { useEffect, useRef, useState } from "react";
import { heroDisplayName } from "@dotastat/core";
import { formatClock, formatRelativeTime } from "../lib/format.js";
import {
  CollapsibleSection,
  EmptyState,
  HeroIcon,
  RankMedal,
} from "./primitives.jsx";
import { DraftAssistant } from "./DraftAssistant.jsx";
import { LiveAdvice, LiveInventory } from "./LiveInventory.jsx";
import { TeamAnalysis } from "./TeamAnalysis.jsx";
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
 * DUZEN: her oyuncu TEK BIR SATIR. Onceki surumde envanter ve tavsiye satirin
 * altina kayiyordu; bir oyuncu uc satir kapliyor, on oyuncu ekrana sigmiyordu
 * ve iki takimi karsilastirmak icin asagi yukari kaydirmak gerekiyordu. Sabit
 * sutunlu bir tablo ayni bilgiyi tek bakista veriyor.
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
  // Hook, altta gelen erken `return`lerden ETKILENMEMESI icin en basta
  // kosulsuz cagrilir (React kurali); `live` henuz yoksa bile guvenli
  // varsayilanlarla calisir.
  const displayClock = useTickingClock(live?.gameTime, Boolean(live?.active));

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
          <strong>{formatClock(displayClock)}</strong>
          <span className="muted micro">{phaseLabel(live.phase)}</span>
        </div>
        <TeamScore
          side="dire"
          score={live.score?.dire}
          mine={live.myTeam === "dire"}
        />
      </div>

      <TeamAnalysis
        analysis={live.teamAnalysis}
        adviceLevel={live.itemAdviceLevel}
        myTeam={live.myTeam}
      />

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
 * Bir takimin oyuncu tablosu.
 *
 * @param {{
 *   title: string,
 *   side: string,
 *   players: Array<Record<string, any>>,
 *   mine: boolean
 * }} props
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
        <div className="live-table-wrap">
          <table className="live-table">
            <thead>
              <tr>
                <th>Oyuncu / Hero</th>
                <th>KDA · LH/DN</th>
                <th>Envanter</th>
                <th>Tavsiye</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((player, index) => (
                <LivePlayerRow key={rowKey(player, index)} player={player} />
              ))}
            </tbody>
          </table>
        </div>
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
 * Canli mac oyuncu satiri (tek satir, dort sutun).
 *
 * Iki tur satir vardir ve ikisi de gecerlidir:
 *   - GSI'li satir  : kimlik + KDA + envanter tam.
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
    <tr className={player.roster ? "known" : ""}>
      <td>
        <div className="live-player-cell">
          <HeroIcon hero={player.hero} size={30} />
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
        </div>
      </td>

      <td>
        {hasStats ? (
          <div className="live-kda-cell">
            <span className="mono">
              {player.kills}/{player.deaths}/{player.assists}
            </span>
            <span className="muted micro mono">
              {Number(player.lastHits || 0)}/{Number(player.denies || 0)}
            </span>
          </div>
        ) : rank ? (
          <RankMedal rank={rank} size={26} />
        ) : (
          <span className="muted micro">veri yok</span>
        )}
      </td>

      <td>
        <LiveInventory player={player} />
      </td>

      <td>
        <LiveAdvice advice={player.itemAdvice} />
      </td>
    </tr>
  );
}

/**
 * GSI faz kodunu okunabilir hale getirir.
 * @param {string} phase
 * @returns {string}
 */
/**
 * Ekranda gosterilen mac saati.
 *
 * SUNUCUDAN GELEN DEGER 5 SANIYEDE BIR TAZELENIYOR (bkz. App.jsx,
 * LIVE_POLL_MS) ama oyundaki saat HER SANIYE ilerliyor. Sunucudan geleni
 * oldugu gibi yazsaydik saat 5'er 5'er ziplardi — toplam dogru ama gozle
 * takip edilemez bir gorunum olurdu.
 *
 * Bu yuzden en son bilinen deger bir CAPA olarak tutulur ve aradaki
 * saniyeler GERCEK ZAMANDAN (Date.now farkindan) turetilir: veri yine 5
 * saniyede bir tazeleniyor, ama saat ekranda birer birer akiyor gibi
 * gorunuyor. Sunucudan YENI bir deger geldiginde (5 saniyelik dilim kapandi,
 * mac degisti, saat geri sardi) capa ANINDA o degere atlar — gosterilen
 * deger hicbir zaman gercek veriden 5 saniyeden fazla uzaklasmaz.
 *
 * @param {number|undefined} gameTime Sunucudan gelen en son saniye
 * @param {boolean} active Mac canli mi (degilse tik atilmaz, saat donmez)
 * @returns {number}
 */
function useTickingClock(gameTime, active) {
  const serverValue = Number(gameTime) || 0;
  /** @type {React.MutableRefObject<{ value: number, at: number }>} */
  const anchorRef = useRef({ value: serverValue, at: Date.now() });
  const [display, setDisplay] = useState(serverValue);

  // Sunucudan yeni deger geldi: capa ve gosterilen deger ANINDA guncellenir.
  useEffect(() => {
    anchorRef.current = { value: serverValue, at: Date.now() };
    setDisplay(serverValue);
  }, [serverValue]);

  // Iki tazeleme arasinda saniyede bir, capadan gercek zamana gore ilerletilir.
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = setInterval(() => {
      const anchor = anchorRef.current;
      const elapsed = Math.floor((Date.now() - anchor.at) / 1000);
      setDisplay(anchor.value + elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  return display;
}

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
