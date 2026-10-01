import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import "./PlayerDetail.css";

const TABS = [
  { key: "overview", label: "Genel" },
  { key: "performance", label: "Performans" },
  { key: "heroes", label: "Hero havuzu" },
  { key: "matches", label: "Son maçlar" },
  { key: "synergy", label: "Sinerji" },
];

const FIT_LABELS = {
  excellent: "Çok uygun",
  good: "Uygun",
  neutral: "Nötr",
  poor: "Zayıf",
};

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

const ROLE_SOURCE_LABELS = {
  manual: "elle seçildi",
  provider: "maç verisinden",
  inferred: "istatistikten çıkarıldı",
  profile: "oyuncu profilinden",
};

/**
 * Secilen oyuncunun detay paneli.
 *
 * @param {{
 *   playerKey: string,
 *   onClose: () => void,
 *   onDataChanged?: () => void,
 *   dataVersion?: string
 * }} props
 */
export function PlayerDetail({
  playerKey,
  onClose,
  onDataChanged,
  dataVersion = "",
}) {
  const [tab, setTab] = useState("overview");
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

  // Genel sekmesinin veriden uretilen ozeti. Yalnizca veri degisince yeniden
  // hesaplanir; ayni veri ayni tavsiyeleri uretir (bkz. core/player-overview).
  const overview = useMemo(
    () =>
      buildPlayerOverview({
        matches: detail.data?.matches || [],
        evaluations: detail.data?.evaluations || [],
        squads: detail.data?.squads || {},
      }),
    [detail.data],
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

  const { player, form, effectivePotential, stats, matches, evaluations } =
    detail.data;

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

      <SummaryStrip
        form={form}
        potential={effectivePotential}
        fetchedAt={detail.data.fetchedAt}
      />

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

      <div className="tab-body">
        {tab === "overview" ? (
          <OverviewTab player={player} overview={overview} onOpenTab={setTab} />
        ) : null}
        {tab === "performance" ? (
          <PerformanceTab evaluations={evaluations} matches={matches} />
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
 * @param {{ form: Record<string, any>, potential: Record<string, any>, fetchedAt: string }} props
 */
function SummaryStrip({ form, potential, fetchedAt }) {
  return (
    <div className="summary-strip">
      <div className="summary-cell">
        <span className="muted">Tahmini seviye</span>
        <strong>
          {potential?.min || 0} – {potential?.max || 0}
        </strong>
        <span className="muted micro">
          {potential?.source === "blended"
            ? "profil + son maçlar"
            : "profil beklentisi"}{" "}
          · gerçek MMR değil
        </span>
      </div>

      <div className="summary-cell">
        <span className="muted">Son maç ortalaması</span>
        <strong>{form?.averagePerformanceRank || 0}</strong>
        <span className="muted micro">Performance Rank</span>
      </div>

      <div className="summary-cell">
        <span className="muted">Form</span>
        <FormStrip form={form?.form || []} />
        <span className="muted micro">
          {form?.wins || 0}/{form?.matches || 0} ·{" "}
          {formatPercent(form?.winRate)}
        </span>
      </div>

      <div className="summary-cell">
        <span className="muted">Eğilim</span>
        <TrendBadge trend={form?.trend} />
        <span className="muted micro">
          veri: {formatRelativeTime(fetchedAt)}
        </span>
      </div>
    </div>
  );
}

/**
 * Genel sekmesi: veriden uretilen dort ozet + tavsiyeler, altinda elle
 * yazilmis karakter notlari.
 *
 * @param {{
 *   player: Record<string, any>,
 *   overview: ReturnType<typeof buildPlayerOverview>,
 *   onOpenTab: (tab: string) => void
 * }} props
 */
function OverviewTab({ player, overview, onOpenTab }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      {overview?.hasData ? (
        <LiveOverview
          playerId={player.id}
          overview={overview}
          onOpenTab={onOpenTab}
        />
      ) : null}
      <CharacterNotes player={player} hasSummary={overview?.hasData} />
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
  const storageKey = "dotastat:overview-seen:" + playerId;
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
 * Veriden uretilen dort kisa ozet ve tavsiyeler.
 *
 * @param {{
 *   playerId: string,
 *   overview: ReturnType<typeof buildPlayerOverview>,
 *   onOpenTab: (tab: string) => void
 * }} props
 */
function LiveOverview({ playerId, overview, onOpenTab }) {
  const fresh = useNewTipKeys(playerId, overview);
  const { performance, heroPool, synergy, recent, tips } = overview;

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
        <button
          type="button"
          className="overview-tile"
          onClick={() => onOpenTab("performance")}
        >
          <span className="muted micro">Performans</span>
          <strong>
            {performance.recentAvgRank || "—"}
            {perfDelta !== null ? (
              <span className="overview-delta">
                <DeltaArrow value={perfDelta} tone={perfTone} />
              </span>
            ) : null}
          </strong>
          <span className="muted micro">
            son {OVERVIEW_RECENT_COUNT} maç PR ort. · {performance.wins}/
            {performance.matches} G ({formatPercent(performance.winRate)})
          </span>
        </button>

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
            son {heroPool.matches} maçta {heroPool.unique} farklı hero
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
              Son maçlarda kadrodan biriyle ortak maç yok.
            </span>
          )}
        </button>

        <button
          type="button"
          className="overview-tile"
          onClick={() => onOpenTab("matches")}
        >
          <span className="muted micro">Son {recent.matches.length} maç</span>
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

      {tips.length ? (
        <article className="note-card wide advice overview-tips">
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
          </ul>
        </article>
      ) : null}
    </>
  );
}

/**
 * Elle yazilmis karakter notlari (eski Genel sekmesi).
 *
 * @param {{ player: Record<string, any>, hasSummary?: boolean }} props
 */
function CharacterNotes({ player, hasSummary = false }) {
  const character = player.character || {};
  const blocks = [
    { label: "Lane davranışı", value: character.laneBehavior },
    { label: "Teamfight davranışı", value: character.teamfightBehavior },
    {
      label: "Harita / tempo / vision",
      value: character.mapTempoVisionBehavior,
    },
    { label: "Takımda en iyi kullanım", value: character.bestTeamUsage },
  ].filter((row) => row.value);

  if (!character.generalPlaystyle && !blocks.length) {
    // Veriden uretilen ozet ekrandaysa bos not uyarisi gereksiz kalabalik.
    return hasSummary ? null : (
      <EmptyState title="Bu oyuncu için karakter notu girilmemiş" />
    );
  }

  return (
    <div className="overview-grid">
      {character.generalPlaystyle ? (
        <article className="note-card wide">
          <h4>Genel oyun tarzı</h4>
          <p>{character.generalPlaystyle}</p>
        </article>
      ) : null}

      <ListCard title="Güçlü yönler" items={character.strengths} tone="good" />
      <ListCard title="Zayıf yönler" items={character.weaknesses} tone="bad" />
      <ListCard
        title="Gelişim alanları"
        items={character.developmentAreas}
        tone="warn"
      />

      {blocks.map((row) => (
        <article key={row.label} className="note-card">
          <h4>{row.label}</h4>
          <p>{row.value}</p>
        </article>
      ))}

      {(character.synergyNotes || []).length ? (
        <ListCard title="Sinerji notları" items={character.synergyNotes} />
      ) : null}

      {character.funnyAdvice ? (
        <article className="note-card wide advice">
          <h4>Tavsiye</h4>
          <p>{character.funnyAdvice}</p>
        </article>
      ) : null}
    </div>
  );
}

/**
 * @param {{ title: string, items?: string[], tone?: string }} props
 */
function ListCard({ title, items, tone }) {
  if (!items || !items.length) {
    return null;
  }
  return (
    <article className={"note-card" + (tone ? " tone-" + tone : "")}>
      <h4>{title}</h4>
      <ul>
        {items.map((row, index) => (
          <li key={index}>{row}</li>
        ))}
      </ul>
    </article>
  );
}

/**
 * @param {{ evaluations: Array<Record<string, any>>, matches: Array<Record<string, any>> }} props
 */
function PerformanceTab({ evaluations, matches }) {
  if (!evaluations?.length) {
    return <EmptyState title="Değerlendirme üretilecek maç bulunamadı" />;
  }

  const matchById = new Map((matches || []).map((row) => [row.matchId, row]));

  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="muted micro">
        Performance Rank gerçek MMR değildir; maçtaki performansın hangi
        seviyeye denk düştüğüne dair tahmindir.
      </p>
      {evaluations.map((row) => {
        const match = matchById.get(row.matchId);
        return (
          <article key={row.matchId} className="eval-row">
            <div className="eval-head">
              <HeroIcon hero={match?.hero} size={32} />
              <div className="eval-head-text">
                <strong>
                  {heroDisplayName(match?.hero) || "Bilinmeyen hero"}
                </strong>
                <span className="muted micro eval-meta">
                  <RoleBadge role={row.role} small />
                  {ROLE_SOURCE_LABELS[row.roleSource] || row.roleSource}
                  {row.heroFit
                    ? " · hero uyumu: " +
                      (FIT_LABELS[row.heroFit] || row.heroFit)
                    : ""}
                </span>
              </div>
              <div className="eval-rank">
                <strong>{row.performanceRank}</strong>
                <span
                  className={
                    "chip " + (match?.result === "win" ? "good" : "bad")
                  }
                >
                  {match?.result === "win" ? "Galibiyet" : "Mağlubiyet"}
                </span>
              </div>
            </div>

            {row.summary ? <p className="eval-summary">{row.summary}</p> : null}

            <div className="eval-lists">
              {(row.strengths || []).length ? (
                <div>
                  <span className="muted micro">İyi giden</span>
                  <ul>
                    {row.strengths.slice(0, 3).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(row.mistakes || []).length ? (
                <div>
                  <span className="muted micro">Geliştirilecek</span>
                  <ul>
                    {row.mistakes.slice(0, 3).map((item, index) => (
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
}) {
  const [openMatchId, setOpenMatchId] = useState("");
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
            {matches.map((row) => (
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

      {openMatch ? (
        <MatchDetailModal
          match={openMatch}
          accountId={accountId}
          squad={squadByMatch[openMatch.matchId] || null}
          evaluation={evaluationByMatch.get(openMatch.matchId) || null}
          mmrChange={changes[openMatch.matchId] || null}
          role={matchRoles?.[openMatch.matchId] || ""}
          onClose={() => setOpenMatchId("")}
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
