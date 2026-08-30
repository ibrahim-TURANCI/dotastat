import { useEffect, useState } from "react";
import {
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
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
  EmptyState,
  FormStrip,
  HeroIcon,
  RankMedal,
  SkeletonBlock,
  TrendBadge,
} from "./primitives.jsx";
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
 * @param {{ playerKey: string, onClose: () => void }} props
 */
export function PlayerDetail({ playerKey, onClose }) {
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
      detail.reload();
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
              <span className="chip accent">
                {ROLE_LABELS[player.dotaProfile?.primaryRole] ||
                  "Rol belirtilmemiş"}
              </span>
              {(player.dotaProfile?.secondaryRoles || []).map((role) => (
                <span key={role} className="chip">
                  {ROLE_SHORT_LABELS[role] || role}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <div className="rank-block">
            <RankMedal rank={player.rank} size={44} />
            {/*
              MMR yalnizca kendi profilinde ve MMR kaynagi kuruluysa gelir.
              Kalan mesafe yildiz genisliginden (154 MMR) hesaplanir.
            */}
            {detail.data.mmrProgress ? (
              <div className="rank-progress">
                <strong>{detail.data.mmrProgress.mmr}</strong>
                {detail.data.mmrProgress.isTop ? (
                  <span className="muted micro">Immortal</span>
                ) : (
                  <span className="muted micro">
                    Kalan rank: {detail.data.mmrProgress.remaining}
                  </span>
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => detail.reload({ refresh: true })}
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
        {tab === "overview" ? <OverviewTab player={player} /> : null}
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
              canEditRoles={detail.data.canEditRoles}
              matchRoles={matchRoles}
              onRoleChange={handleRoleChange}
              mmrByMatch={detail.data.mmrByMatch}
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
 * @param {{ player: Record<string, any> }} props
 */
function OverviewTab({ player }) {
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
    return <EmptyState title="Bu oyuncu için karakter notu girilmemiş" />;
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
                <span className="muted micro">
                  {ROLE_SHORT_LABELS[row.role] || row.role} ·{" "}
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
  canEditRoles,
  matchRoles,
  onRoleChange,
  mmrByMatch,
}) {
  // MMR yalnizca DotaPlus kuruluysa gelir; yoksa sutun hic gosterilmez.
  const hasMmr = Object.keys(mmrByMatch || {}).length > 0;
  if (!matches?.length) {
    return <EmptyState title="Maç bulunamadı" />;
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {canEditRoles ? (
        <p className="muted micro">
          Bu senin profilin. Bir maçta hangi pozisyonu oynadığını seçersen
          değerlendirme o pozisyonun ölçütleriyle yapılır ve otomatik tahminin
          önüne geçer.
        </p>
      ) : null}

      <table className="data-table">
        <thead>
          <tr>
            <th>Hero</th>
            <th>Sonuç</th>
            {hasMmr ? <th>MMR</th> : null}
            <th>Pozisyon</th>
            <th>KDA</th>
            <th>GPM / XPM</th>
            <th>Süre</th>
            <th>Tarih</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((row) => (
            <tr key={row.matchId}>
              <td>
                <span className="row" style={{ gap: 7 }}>
                  <HeroIcon hero={row.hero} size={24} />
                  {heroDisplayName(row.hero)}
                </span>
              </td>
              <td>
                <span
                  className={"chip " + (row.result === "win" ? "good" : "bad")}
                >
                  {row.result === "win" ? "G" : "M"}
                </span>
              </td>
              {hasMmr ? (
                <td>
                  <MmrCell change={mmrByMatch[row.matchId]} />
                </td>
              ) : null}
              <td>
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
  );
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
  const positive = change.delta > 0;
  return (
    // Maçtan SONRAKİ MMR önde, parantez içinde o maçın farkı — oyuncunun
    // alıştığı gösterim bu.
    <span className="mmr-cell">
      <strong>{change.mmr}</strong>
      <span className={"chip " + (positive ? "good" : "bad")}>
        {positive ? "+" : ""}
        {change.delta}
      </span>
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
      <span className="chip">{ROLE_SHORT_LABELS[effective] || effective}</span>
    ) : (
      <span className="muted micro">bilinmiyor</span>
    );
  }

  return (
    <div className="role-cell">
      <select
        className="role-select"
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
