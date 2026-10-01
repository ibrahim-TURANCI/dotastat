import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PERIOD,
  OVERVIEW_RECENT_COUNT,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  buildPlayerOverview,
  heroDisplayName,
} from "@dotastat/core";
import { api } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import {
  formatClock,
  formatKda,
  formatPercent,
  formatRelativeTime,
} from "../lib/format.js";
import {
  DeltaArrow,
  EmptyState,
  FormStrip,
  HeroIcon,
  RankMedal,
  RoleBadge,
  SkeletonBlock,
  TrendBadge,
} from "./primitives.jsx";
import { MatchDetailModal } from "./MatchDetailModal.jsx";
import { PeriodSwitch } from "./PeriodSwitch.jsx";
import "./PlayerDetail.css";

const TABS = [
  { key: "overview", label: "Genel" },
  { key: "heroes", label: "Hero havuzu" },
  { key: "matches", label: "Son maçlar" },
  { key: "synergy", label: "Sinerji" },
];

/** Son Maclar sekmesinde bir sayfadaki mac sayisi. */
const MATCHES_PAGE_SIZE = 10;

/**
 * "Yenile" butonunun ipucu metni.
 *
 * Buton kapaliyken SEBEBI yazmasi onemli: onbellek tum ziyaretciler arasinda
 * paylasildigi icin cok yeni veri yeniden cekilmez, ama bu disaridan
 * "buton bozuk" gibi gorunuyor.
 *
 * @param {number} waitMs Yeni tazelemeye kalan sure
 * @param {boolean} busy
 * @returns {string}
 */
export function refreshTooltip(waitMs, busy) {
  if (busy) {
    return "Veri çekiliyor…";
  }
  if (waitMs <= 0) {
    return "Veriyi kaynaktan yeniden çeker";
  }
  // Saniye kalmissa "0 dakika" yazmamak icin yukari yuvarlanir.
  const minutes = Math.ceil(waitMs / 60000);
  return (
    "Veri az önce güncellendi — 5 dakika dolmadan tekrar istek atılamaz. " +
    (minutes > 1 ? minutes + " dakika" : "Yaklaşık 1 dakika") +
    " sonra tekrar yenilenebilir."
  );
}

/**
 * Secilen oyuncunun detay paneli.
 *
 * @param {{
 *   playerKey: string,
 *   onClose: () => void,
 *   onDataChanged?: () => void,
 *   dataVersion?: string,
 *   period?: string
 * }} props `period`: listede secili donem; Genel sekmesi onunla acilir.
 */
export function PlayerDetail({
  playerKey,
  onClose,
  onDataChanged,
  dataVersion = "",
  period: listPeriod = DEFAULT_PERIOD,
}) {
  const [tab, setTab] = useState("overview");
  // Genel sekmesinin donemi. Listede donem degisirse buraya da yansir;
  // burada degistirmek listeyi etkilemez.
  const [period, setPeriod] = useState(listPeriod);
  useEffect(() => {
    setPeriod(listPeriod);
  }, [listPeriod]);
  // Panel acilirken onbellekten okur; saglayiciya yalnizca "Yenile" ile gider.
  const detail = useAsyncData((options) => api.player(playerKey, options), {
    deps: [playerKey],
  });

  // Pozisyon secimleri yerelde de tutulur: sunucuya yazarken listenin aninda
  // guncellenmesi icin. Sunucudan yeni veri gelince buradan tazelenir.
  const [matchRoles, setMatchRoles] = useState({});
  const [roleError, setRoleError] = useState("");
  // Onbellek paylasildigi icin cok yeni veri yeniden cekilmez; buton verinin
  // yasina gore kapanir (bkz. player-data-service -> MIN_REFRESH_INTERVAL_MS).
  const refreshWaitMs = detail.data?.refreshAvailableInMs || 0;

  useEffect(() => {
    setMatchRoles(detail.data?.matchRoles || {});
    setRoleError("");
  }, [detail.data]);

  // Kart listesi ortak onbellegi dakikada bir yokluyor; kadroda biri yeni
  // veri cektiginde (`dataVersion` = en taze verinin zamani) panel de
  // onbellekten yeniden okunur. Kaynaga GIDILMEZ; Genel sekmesinin ozeti ve
  // Son Maclar'daki kadro eslesmesi boylece kendiliginden guncellenir.
  const seenVersion = useRef(dataVersion);
  useEffect(() => {
    if (!dataVersion || dataVersion === seenVersion.current) {
      return;
    }
    seenVersion.current = dataVersion;
    detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Genel sekmesinin veriden uretilen ozeti, secili doneme gore (Hafta / Ay /
  // Son 60). Yalnizca veri ya da donem degisince yeniden hesaplanir; ayni veri
  // ayni tavsiyeleri uretir (bkz. core/player-overview).
  const overview = useMemo(
    () =>
      buildPlayerOverview({
        matches: detail.data?.matches || [],
        evaluations: detail.data?.evaluations || [],
        squads: detail.data?.squads || {},
        period,
        now: Date.now(),
      }),
    [detail.data, period],
  );

  /**
   * @param {string} matchId
   * @param {string} role "" ise secim kaldirilir
   */
  async function handleRoleChange(matchId, role) {
    const previous = matchRoles;
    // Iyimser guncelleme: acilir liste aninda tepki versin.
    setMatchRoles({ ...previous, [matchId]: role });
    setRoleError("");
    try {
      const response = await api.setMatchRole(matchId, role);
      setMatchRoles(response.roles || {});
      // Degerlendirme sunucuda yeniden hesaplandigi icin paneli tazele.
      await detail.reload();
      // Performance Rank degisti; kart listesi de bunu gostermeli.
      onDataChanged?.();
    } catch (error) {
      setMatchRoles(previous);
      setRoleError(error?.message || "Pozisyon kaydedilemedi");
    }
  }

  if (detail.loading) {
    return (
      <div className="player-detail">
        <SkeletonBlock lines={6} height={22} />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="player-detail">
        <EmptyState
          title="Oyuncu detayı alınamadı"
          detail={detail.error?.message || "Bilinmeyen hata"}
          action={
            <button type="button" className="btn small" onClick={detail.reload}>
              Tekrar dene
            </button>
          }
        />
      </div>
    );
  }

  const { player, form, stats, matches, evaluations } = detail.data;

  return (
    <div className="player-detail">
      <div className="player-detail-head">
        <div className="row" style={{ gap: 12 }}>
          {player.avatar ? (
            <img
              className="player-avatar"
              src={player.avatar}
              alt={player.name}
            />
          ) : null}
          <div>
            <h3>{player.name}</h3>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {player.dotaProfile?.primaryRole ? (
                <RoleBadge
                  role={player.dotaProfile.primaryRole}
                  label={ROLE_LABELS[player.dotaProfile.primaryRole]}
                />
              ) : (
                <span className="chip">Rol belirtilmemiş</span>
              )}
              {(player.dotaProfile?.secondaryRoles || []).map((role) => (
                <RoleBadge key={role} role={role} small />
              ))}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <div className="rank-block">
            <RankMedal rank={player.rank} size={44} />
            <RankProgress progress={detail.data.mmrProgress} />
          </div>
          <span
            className="muted micro"
            title="Verinin kaynaktan en son çekildiği zaman"
          >
            veri: {formatRelativeTime(detail.data.fetchedAt)}
          </span>
          <button
            type="button"
            className="btn ghost small"
            onClick={async () => {
              const result = await detail.reload({ refresh: true });
              // Ayni veri kartlari da besliyor; liste eski kalmasin.
              if (result?.ok) {
                onDataChanged?.();
              }
            }}
            disabled={detail.refreshing || refreshWaitMs > 0}
            title={refreshTooltip(refreshWaitMs, detail.refreshing)}
          >
            {detail.refreshing ? "Yenileniyor…" : "Yenile"}
          </button>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>

      {detail.data.historyUnavailable ? (
        <p className="chip warn" role="status">
          Bu oyuncunun maç geçmişi gizli — Dota 2 → Ayarlar → Seçenekler →
          Gelişmiş Seçenekler’den “Maç Verilerini Herkese Açık Yap” kapalı. Rank
          görünüyor ama maç verisi hiçbir kaynaktan alınamıyor.
        </p>
      ) : null}

      <div className="tabs-bar">
        <nav className="tabs" role="tablist">
          {TABS.map((row) => (
            <button
              key={row.key}
              type="button"
              role="tab"
              aria-selected={tab === row.key}
              className={"tab" + (tab === row.key ? " active" : "")}
              onClick={() => setTab(row.key)}
            >
              {row.label}
            </button>
          ))}
        </nav>
        {/* Donem yalnizca Genel sekmesinin ozetini etkiler. */}
        {tab === "overview" && overview.hasData ? (
          <PeriodSwitch value={period} onChange={setPeriod} />
        ) : null}
      </div>

      <div className="tab-body">
        {tab === "overview" ? (
          <OverviewTab
            player={player}
            overview={overview}
            form={form}
            onOpenTab={setTab}
          />
        ) : null}
        {tab === "heroes" ? (
          <HeroPoolTab
            player={player}
            stats={stats}
            heroPool={detail.data.heroPool}
          />
        ) : null}
        {tab === "matches" ? (
          <>
            {roleError ? (
              <p className="chip bad" role="alert">
                {roleError}
              </p>
            ) : null}
            <MatchesTab
              matches={matches}
              evaluations={evaluations}
              canEditRoles={detail.data.canEditRoles}
              matchRoles={matchRoles}
              onRoleChange={handleRoleChange}
              mmrByMatch={detail.data.mmrByMatch}
              squads={detail.data.squads}
              accountId={String(player.player_id || "")}
              onRosterRefreshed={() => {
                // Mac detayi kadro uyelerini tazeledi ya da takim
                // pozisyonlarini kaydetti: kadro eslesmesi, pozisyonlar ve
                // kart listesi onbellekten yeniden okunur.
                detail.reload();
                onDataChanged?.();
              }}
            />
          </>
        ) : null}
        {tab === "synergy" ? (
          <SynergyTab synergies={detail.data.synergies} player={player} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Genel sekmesi: KISA ozet. Dort ozet kutusu (secili doneme gore), tek bir
 * tavsiye karti, oyun tarzi ve guclu / zayif yonler. Ayrintilar ilgili
 * sekmelerde.
 *
 * @param {{
 *   player: Record<string, any>,
 *   overview: ReturnType<typeof buildPlayerOverview>,
 *   form: Record<string, any>,
 *   onOpenTab: (tab: string) => void
 * }} props
 */
function OverviewTab({ player, overview, form, onOpenTab }) {
  const character = player.character || {};
  return (
    <div className="stack" style={{ gap: 14 }}>
      {overview?.hasData ? (
        <LiveOverview overview={overview} form={form} onOpenTab={onOpenTab} />
      ) : null}
      <AdviceCard
        playerId={player.id}
        overview={overview}
        character={character}
      />
      <CharacterNotes character={character} hasSummary={overview?.hasData} />
    </div>
  );
}

/**
 * "Yeni" rozeti alacak tavsiye anahtarlari.
 *
 * Tavsiyeler veriden uretildigi icin ayni veri ayni listeyi verir; rozet
 * yalnizca VERI DEGISTIGINDE (imza farkli) ve daha once gosterilmemis bir
 * tavsiye ciktiginda yanar. Ilk ziyarette kiyas yok, rozet de yok. Kayit
 * tarayicida tutulur; erisilemezse rozet hic gosterilmez.
 *
 * @param {string} playerId
 * @param {{ signature: string, tips: Array<{ key: string }> }} overview
 * @returns {Set<string>}
 */
function useNewTipKeys(playerId, overview) {
  const [fresh, setFresh] = useState(() => new Set());
  // Donem basina ayri kayit: donem degistirmek tavsiyeleri "yeni" yapmasin.
  const storageKey =
    "dotastat:overview-seen:" + playerId + ":" + (overview?.period?.key || "");
  const signature = overview?.signature || "";
  const keys = (overview?.tips || []).map((row) => row.key);
  const keysText = keys.join("|");

  useEffect(() => {
    let previous = null;
    try {
      previous = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    } catch {
      previous = null;
    }
    if (previous && previous.signature !== signature) {
      const seen = new Set(Array.isArray(previous.keys) ? previous.keys : []);
      setFresh(new Set(keys.filter((key) => !seen.has(key))));
    } else if (!previous) {
      setFresh(new Set());
    }
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ signature, keys }),
      );
    } catch {
      // Depolama kapali: rozet gosterilmez, baska bir sey etkilenmez.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, signature, keysText]);

  return fresh;
}

/**
 * Veriden uretilen dort kisa ozet.
 *
 * @param {{
 *   overview: ReturnType<typeof buildPlayerOverview>,
 *   form: Record<string, any>,
 *   onOpenTab: (tab: string) => void
 * }} props
 */
function LiveOverview({ overview, form, onOpenTab }) {
  const { performance, heroPool, synergy, recent, period } = overview;

  const perfDelta = performance.delta;
  const perfTone =
    performance.trend === "up"
      ? "up"
      : performance.trend === "down"
        ? "down"
        : "flat";

  return (
    <>
      <div className="overview-summary">
        {/* Bilgi kutusu: bir sekme acmaz. */}
        <div
          className="overview-tile static"
          title="Performance Rank gerçek MMR değildir; maçtaki performansın hangi seviyeye denk düştüğüne dair tahmindir."
        >
          <span className="muted micro">
            Performans ortalaması · {period.label}
          </span>
          <strong>
            {performance.avgRank || "—"}
            {perfDelta !== null ? (
              <span className="overview-delta">
                <DeltaArrow value={perfDelta} tone={perfTone} />
              </span>
            ) : null}
          </strong>
          <span className="muted micro">
            {performance.matches
              ? `${performance.matches} maç · ${performance.wins} G (${formatPercent(performance.winRate)})`
              : "Bu dönemde maç yok"}
          </span>
        </div>

        <button
          type="button"
          className="overview-tile"
          onClick={() => onOpenTab("heroes")}
        >
          <span className="muted micro">Hero havuzu</span>
          <span className="overview-heroes">
            {heroPool.top.map((row) => (
              <HeroIcon
                key={row.hero}
                hero={row.hero}
                size={24}
                title={
                  heroDisplayName(row.hero) +
                  " · " +
                  row.matches +
                  " maç · " +
                  formatPercent(row.winRate)
                }
              />
            ))}
          </span>
          <span className="muted micro">
            {heroPool.matches
              ? `${heroPool.matches} maçta ${heroPool.unique} farklı hero`
              : "Bu dönemde maç yok"}
          </span>
        </button>

        <button
          type="button"
          className="overview-tile"
          onClick={() => onOpenTab("synergy")}
        >
          <span className="muted micro">Sinerji</span>
          {synergy.partners.length ? (
            <>
              <strong className="overview-partner">
                {synergy.partners[0].name}
                <span className="muted micro">
                  {" "}
                  {synergy.partners[0].matches} maç ·{" "}
                  {formatPercent(synergy.partners[0].winRate)}
                </span>
              </strong>
              <span className="muted micro">
                parti {formatPercent(synergy.stack.winRate)} (
                {synergy.stack.matches}) · solo{" "}
                {formatPercent(synergy.solo.winRate)} ({synergy.solo.matches})
              </span>
            </>
          ) : (
            <span className="muted micro">
              Bu dönemde kadrodan biriyle ortak maç yok.
            </span>
          )}
        </button>

        <button
          type="button"
          className="overview-tile"
          onClick={() => onOpenTab("matches")}
        >
          <span className="overview-tile-head">
            <span className="muted micro">Son maçlar</span>
            {/* Eski ust seritteki "Egilim": son maclarin PR yonu. */}
            <TrendBadge trend={form?.trend} />
          </span>
          <FormStrip
            form={recent.matches.map((row) => row.result)}
            max={OVERVIEW_RECENT_COUNT}
          />
          <span className="muted micro">
            {recent.wins}G {recent.losses}M · KDA {recent.avgKda}
            {recent.streak.count >= 2
              ? " · " +
                recent.streak.count +
                (recent.streak.type === "win" ? " galibiyet" : " mağlubiyet") +
                " serisi"
              : ""}
          </span>
        </button>
      </div>
    </>
  );
}

/**
 * Tek tavsiye karti: veriden uretilen tavsiyeler (secili doneme gore), elle
 * yazilmis sinerji notlari ve oyuncuya ozel tavsiye. Eskiden uc ayri kartti.
 *
 * @param {{
 *   playerId: string,
 *   overview: ReturnType<typeof buildPlayerOverview>,
 *   character: Record<string, any>
 * }} props
 */
function AdviceCard({ playerId, overview, character }) {
  const fresh = useNewTipKeys(playerId, overview);
  const tips = overview?.hasData ? overview.tips : [];
  const notes = [
    ...(character.synergyNotes || []),
    ...(character.funnyAdvice ? [character.funnyAdvice] : []),
  ].filter(Boolean);

  if (!tips.length && !notes.length) {
    return null;
  }

  return (
    <article className="note-card advice overview-tips">
      <h4>Tavsiyeler</h4>
      <ul>
        {tips.map((row) => (
          <li key={row.key} className={"tip tone-" + row.tone}>
            {row.text}
            {fresh.has(row.key) ? (
              <span className="chip accent tip-new">yeni</span>
            ) : null}
          </li>
        ))}
        {notes.map((text, index) => (
          <li key={"note-" + index} className="tip tone-note">
            {text}
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * Elle yazilmis karakter notlari: oyun tarzi ve guclu / zayif yonler.
 *
 * @param {{ character: Record<string, any>, hasSummary?: boolean }} props
 */
function CharacterNotes({ character, hasSummary = false }) {
  const styleRows = [
    { label: "Lane", value: character.laneBehavior },
    { label: "Teamfight", value: character.teamfightBehavior },
    { label: "Harita / tempo", value: character.mapTempoVisionBehavior },
    { label: "Takımdaki yeri", value: character.bestTeamUsage },
  ].filter((row) => row.value);
  const traits = [
    { tone: "good", label: "Güçlü", items: character.strengths },
    { tone: "bad", label: "Zayıf", items: character.weaknesses },
    { tone: "warn", label: "Gelişim", items: character.developmentAreas },
  ].filter((row) => row.items?.length);

  if (!character.generalPlaystyle && !styleRows.length && !traits.length) {
    // Veriden uretilen ozet ekrandaysa bos not uyarisi gereksiz kalabalik.
    return hasSummary ? null : (
      <EmptyState title="Bu oyuncu için karakter notu girilmemiş" />
    );
  }

  return (
    <div className="overview-grid">
      {character.generalPlaystyle || styleRows.length ? (
        <article className="note-card">
          <h4>Oyun tarzı</h4>
          {character.generalPlaystyle ? (
            <p>{character.generalPlaystyle}</p>
          ) : null}
          {styleRows.length ? (
            <dl className="style-list">
              {styleRows.map((row) => (
                <Fragment key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}
        </article>
      ) : null}

      {traits.length ? (
        <article className="note-card">
          <h4>Güçlü ve zayıf yönler</h4>
          <div className="trait-columns">
            {traits.map((row) => (
              <div key={row.tone} className={"trait-col tone-" + row.tone}>
                <span className="trait-label">{row.label}</span>
                <ul>
                  {row.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </div>
  );
}

/**
 * @param {{ player: Record<string, any>, stats: Record<string, any> }} props
 */
function HeroPoolTab({ player, stats, heroPool }) {
  const profile = player.dotaProfile || {};

  // Her bolum farkli bir veri penceresine bakar; alt basliklar bunu acikca
  // yaziyor ki "neden bu hero burada" sorusu ekranda cevaplansin.
  const sections = [
    {
      key: "signature",
      fallbackKey: "signatureHeroes",
      label: "İmza kahramanlar",
      hint: "tüm oyunlarda en çok oynanan ve kazanılan",
      tone: "good",
    },
    {
      key: "preferred",
      fallbackKey: "preferredHeroes",
      label: "Tercih ettikleri",
      hint: "son maçlarda sık alınan",
    },
    {
      key: "recommended",
      fallbackKey: "experimentalHeroes",
      label: "Tavsiye edilenler",
      hint: "tarzına uygun, az ya da hiç oynanmamış",
      tone: "warn",
    },
    {
      key: "weak",
      fallbackKey: "weakHeroes",
      label: "Zayıf olduğu",
      hint: "yeterince oynanmış ama kazanılamayan",
      tone: "bad",
    },
  ];

  return (
    <div className="stack" style={{ gap: 14 }}>
      {heroPool?.derivedFrom === "recent" ? (
        <p className="muted micro">
          Tüm zamanların hero verisi alınamadı; listeler yalnızca son maçlardan
          türetildi.
        </p>
      ) : null}

      {sections.map((section) => {
        // Turetilmis havuz varsa gerekceleriyle birlikte kullanilir; yoksa
        // (eski onbellek, veri gelmedi) duz hero listesine dusulur.
        const derived = heroPool?.[section.key] || [];
        const heroes = derived.length
          ? derived
          : (profile[section.fallbackKey] || []).map((hero) => ({
              hero,
              reason: "",
            }));

        if (!heroes.length) {
          return null;
        }

        return (
          <div key={section.key}>
            <h4 className="pool-title">
              {section.label}
              <span className="muted micro"> · {section.hint}</span>
            </h4>
            <div className="hero-row">
              {heroes.map((row) => (
                <span
                  key={row.hero}
                  className={"hero-pill " + (section.tone || "")}
                  title={row.reason || undefined}
                >
                  <HeroIcon hero={row.hero} size={26} />
                  <span className="hero-pill-text">
                    {heroDisplayName(row.hero)}
                    {row.reason ? (
                      <span className="muted micro">{row.reason}</span>
                    ) : null}
                  </span>
                </span>
              ))}
            </div>
          </div>
        );
      })}

      <div>
        <h4 className="pool-title">Son maçlarda en çok oynananlar</h4>
        {(stats?.heroes || []).length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Hero</th>
                <th>Maç</th>
                <th>Galibiyet</th>
                <th>Ort. KDA</th>
              </tr>
            </thead>
            <tbody>
              {stats.heroes.slice(0, 12).map((row) => (
                <tr key={row.hero}>
                  <td>
                    <span className="row" style={{ gap: 7 }}>
                      <HeroIcon hero={row.hero} size={24} />
                      {heroDisplayName(row.hero)}
                    </span>
                  </td>
                  <td>{row.matches}</td>
                  <td>{formatPercent(row.winRate)}</td>
                  <td>{row.avgKda}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Hero istatistiği yok" />
        )}
      </div>
    </div>
  );
}

/**
 * @param {{ matches: Array<Record<string, any>> }} props
 */
function MatchesTab({
  matches,
  evaluations,
  canEditRoles,
  matchRoles,
  onRoleChange,
  mmrByMatch,
  squads,
  accountId,
  onRosterRefreshed,
}) {
  const [openMatchId, setOpenMatchId] = useState("");
  const [page, setPage] = useState(0);
  const squadByMatch = squads || {};
  // MMR sutunu HER ZAMAN durur. Eskiden kayit yoksa sutun tamamen
  // gizleniyordu; tablo oyuncudan oyuncuya sutun degistiriyor ve "MMR nereye
  // gitti" sorusunu doguruyordu. Eslesme bulunamayan satirda hucre "—" kalir
  // ve sebebini basligin ipucu yaziyor.
  const changes = mmrByMatch || {};
  // Performance Rank mac bazinda degerlendirmeden gelir (gercek MMR degil).
  const rankByMatch = new Map(
    (evaluations || []).map((row) => [row.matchId, row.performanceRank]),
  );
  if (!matches?.length) {
    return <EmptyState title="Maç bulunamadı" />;
  }
  const evaluationByMatch = new Map(
    (evaluations || []).map((row) => [row.matchId, row]),
  );
  const openMatch = openMatchId
    ? matches.find((row) => row.matchId === openMatchId) || null
    : null;
  // Liste yeniden okununca (ornek: mac detayindan sonra) sayfa korunur; mac
  // sayisi azaldiysa son sayfaya cekilir.
  const pageCount = Math.max(1, Math.ceil(matches.length / MATCHES_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = matches.slice(
    currentPage * MATCHES_PAGE_SIZE,
    (currentPage + 1) * MATCHES_PAGE_SIZE,
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      {canEditRoles ? (
        <p className="muted micro">
          Bu senin profilin. Bir maçta hangi pozisyonu oynadığını seçersen
          değerlendirme o pozisyonun ölçütleriyle yapılır ve otomatik tahminin
          önüne geçer.
        </p>
      ) : null}

      <p className="muted micro">
        Detay için bir maça tıkla. Hero'nun yanındaki sayı, o maçta kadromuzdan
        kaç kişinin aynı takımda olduğunu gösterir.
      </p>

      <div className="data-table-wrap">
        <table className="data-table matches-table">
          <thead>
            <tr>
              <th>Hero</th>
              <th>Sonuç</th>
              <th title="Bu maçtaki performansın hangi seviyeye denk düştüğü — gerçek MMR değil">
                Perf. Rank
              </th>
              <th title="Maçtan sonraki MMR ve o maçın farkı. Yalnızca masaüstü uygulaması açıkken oynanan maçlar için okunabiliyor; diğerlerinde boş kalır.">
                MMR
              </th>
              <th>Pozisyon</th>
              <th>KDA</th>
              <th>GPM / XPM</th>
              <th>Süre</th>
              <th>Tarih</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr
                key={row.matchId}
                className="match-row"
                tabIndex={0}
                onClick={() => setOpenMatchId(row.matchId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpenMatchId(row.matchId);
                  }
                }}
                aria-label={heroDisplayName(row.hero) + " maçının detayı"}
              >
                <td>
                  <span className="row" style={{ gap: 7 }}>
                    <HeroIcon hero={row.hero} size={24} />
                    {heroDisplayName(row.hero)}
                    <StackBadge squad={squadByMatch[row.matchId]} />
                  </span>
                </td>
                <td>
                  <span
                    className={
                      "chip " + (row.result === "win" ? "good" : "bad")
                    }
                  >
                    {row.result === "win" ? "G" : "M"}
                  </span>
                </td>
                <td>
                  <PerformanceRankCell value={rankByMatch.get(row.matchId)} />
                </td>
                <td>
                  <MmrCell change={changes[row.matchId]} />
                </td>
                <td
                  // Pozisyon secimi satirin tiklamasini (detay) tetiklememeli.
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <RoleCell
                    matchId={row.matchId}
                    detectedRole={row.role}
                    selectedRole={matchRoles?.[row.matchId] || ""}
                    editable={Boolean(canEditRoles)}
                    onChange={onRoleChange}
                  />
                </td>
                <td>
                  {row.kills}/{row.deaths}/{row.assists}
                  <span className="muted micro"> ({formatKda(row)})</span>
                </td>
                <td>
                  {row.gpm} / {row.xpm}
                </td>
                <td>{formatClock(row.durationSeconds)}</td>
                <td className="muted">{formatRelativeTime(row.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <nav className="matches-pager" aria-label="Maç sayfaları">
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 0}
          >
            ‹ Önceki
          </button>
          <span className="muted micro">
            Sayfa {currentPage + 1} / {pageCount} · {matches.length} maç
          </span>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= pageCount - 1}
          >
            Sonraki ›
          </button>
        </nav>
      ) : null}

      {openMatch ? (
        <MatchDetailModal
          match={openMatch}
          accountId={accountId}
          squad={squadByMatch[openMatch.matchId] || null}
          evaluation={evaluationByMatch.get(openMatch.matchId) || null}
          mmrChange={changes[openMatch.matchId] || null}
          role={matchRoles?.[openMatch.matchId] || ""}
          onClose={() => setOpenMatchId("")}
          onRosterRefreshed={onRosterRefreshed}
        />
      ) : null}
    </div>
  );
}

/**
 * Macta kadromuzdan kac kisinin AYNI takimda oldugu.
 *
 * Tek basina oynanan macta rozet cizilmez: "1" bilgi tasimaz, yalnizca
 * kalabalik yapar. Ipucu kimlerin oldugunu (ve varsa rakipteki kadro
 * uyelerini) yazar.
 *
 * @param {{ squad?: { members: Array<Record<string, any>>, allies: number, enemies: number } }} props
 */
function StackBadge({ squad }) {
  if (!squad || (squad.allies < 2 && !squad.enemies)) {
    return null;
  }
  const members = squad.members || [];
  const names = members
    .filter((row) => row.team === "ally")
    .map((row) => row.name);
  const rivals = members
    .filter((row) => row.team === "enemy")
    .map((row) => row.name);
  const title =
    "Kadromuzdan: " +
    names.join(", ") +
    (rivals.length ? " · Rakip takımda: " + rivals.join(", ") : "");
  return (
    <span className="chip accent stack-chip" title={title}>
      {squad.allies}
      {rivals.length ? (
        <span className="stack-rival">+{rivals.length}</span>
      ) : null}
    </span>
  );
}

/**
 * Madalyanın yanındaki MMR ve bir sonraki yıldıza kalan mesafe.
 *
 * İKİ KAYNAK VAR ve ayrımı görünür olmalı:
 *   - ÖLÇÜLEN: oyuncu masaüstü uygulamasını kurmuş, değer oyundan okunmuş.
 *   - YAKLAŞIK: kurulum yok; değer madalya + yıldızdan türetilmiş, "~" ve
 *     "yaklaşık" etiketiyle gösterilir (bkz. core → approximateMmrFromRank).
 *
 * @param {{ progress?: { mmr: number, remaining: number, isTop: boolean, approximate: boolean } }} props
 */
function RankProgress({ progress }) {
  if (!progress) {
    return null;
  }
  return (
    <div className="rank-progress">
      <strong>
        {progress.approximate ? "~" : ""}
        {progress.mmr}
      </strong>
      {progress.isTop ? (
        <span className="muted micro">Immortal</span>
      ) : (
        <span className="muted micro">
          Kalan rank: {progress.approximate ? "~" : ""}
          {progress.remaining}
        </span>
      )}
      {progress.approximate ? (
        <span
          className="muted micro"
          title="Bu oyuncunun gerçek MMR'ı okunamıyor; değer madalyasından hesaplandı."
        >
          yaklaşık
        </span>
      ) : null}
    </div>
  );
}

/**
 * Maç satırındaki Performance Rank.
 *
 * GERÇEK MMR DEĞİLDİR: o maçtaki oyunun hangi seviyeye denk düştüğü
 * tahminidir (bkz. performance-evaluation-engine).
 *
 * @param {{ value?: number }} props
 */
function PerformanceRankCell({ value }) {
  const rank = Number(value) || 0;
  if (!rank) {
    return <span className="muted micro">—</span>;
  }
  return <span className="perf-rank-cell">{rank}</span>;
}

/**
 * Bir maçtaki MMR değişimi.
 *
 * Değer DotaPlus'ın oyundan okuduğu GERÇEK MMR'dan türer (bkz.
 * services/mmr-watcher.js); tahmin değildir. Eşleşmeyen maçlarda hücre boş
 * kalır — MMR yalnızca uygulama açıkken oynanan maçlar için birikir.
 *
 * @param {{ change?: { delta: number, mmr: number } }} props
 */
function MmrCell({ change }) {
  if (!change) {
    return <span className="muted micro">—</span>;
  }
  return (
    // Maçtan SONRAKİ MMR önde, yanında o maçın farkı (▲/▼) — oyuncunun
    // alıştığı gösterim bu.
    <span className="mmr-cell">
      <strong>{change.mmr}</strong>
      <DeltaArrow value={change.delta} pill />
    </span>
  );
}

/**
 * Tek macin pozisyon hucresi.
 *
 * Kendi profilinde acilir liste, baskasinin profilinde salt okunur etikettir.
 * Secim yapilmamissa saglayicinin tahmini gosterilir ve "tahmin" olarak
 * isaretlenir; kullanici secince etiket "senin seçimin"e doner.
 *
 * @param {{
 *   matchId: string,
 *   detectedRole: string,
 *   selectedRole: string,
 *   editable: boolean,
 *   onChange?: (matchId: string, role: string) => void
 * }} props
 */
function RoleCell({ matchId, detectedRole, selectedRole, editable, onChange }) {
  const effective = selectedRole || detectedRole || "";

  if (!editable) {
    return effective ? (
      <RoleBadge role={effective} />
    ) : (
      <span className="muted micro">bilinmiyor</span>
    );
  }

  return (
    <div className="role-cell">
      <select
        className="role-select"
        // Secicinin cercevesi rozetlerle ayni pozisyon renginde.
        style={
          ROLE_KEYS.includes(effective)
            ? { "--role-c": "var(--role-" + effective + ")" }
            : undefined
        }
        value={selectedRole}
        aria-label="Bu maçtaki pozisyonun"
        onChange={(event) => onChange?.(matchId, event.target.value)}
      >
        <option value="">
          {detectedRole
            ? `Tahmin: ${ROLE_SHORT_LABELS[detectedRole] || detectedRole}`
            : "Tahmin yok"}
        </option>
        {ROLE_KEYS.map((role) => (
          <option key={role} value={role}>
            {ROLE_SHORT_LABELS[role]}
          </option>
        ))}
      </select>
      {selectedRole ? <span className="muted micro">senin seçimin</span> : null}
    </div>
  );
}

/**
 * @param {{ synergies: Array<Record<string, any>>, player: Record<string, any> }} props
 */
function SynergyTab({ synergies, player }) {
  if (!synergies?.length) {
    return <EmptyState title="Bu oyuncu için sinerji notu girilmemiş" />;
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {synergies.map((row) => {
        const partner =
          row.playerId1 === player.id ? row.playerId2 : row.playerId1;
        return (
          <article key={row.id} className="note-card">
            <h4>
              {partner}
              {row.synergyScore ? (
                <span className="chip accent" style={{ marginLeft: 8 }}>
                  {row.synergyScore}/100
                </span>
              ) : null}
            </h4>
            {row.description ? <p>{row.description}</p> : null}
            <div className="eval-lists">
              {(row.strengths || []).length ? (
                <div>
                  <span className="muted micro">Güçlü taraf</span>
                  <ul>
                    {row.strengths.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(row.risks || []).length ? (
                <div>
                  <span className="muted micro">Risk</span>
                  <ul>
                    {row.risks.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
