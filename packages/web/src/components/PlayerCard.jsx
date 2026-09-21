import {
  MATCH_FETCH_SIZE,
  PERIOD_HERO_COUNT,
  ROLE_SHORT_LABELS,
} from "@dotastat/core";
import { formatPercent, formatRelativeTime } from "../lib/format.js";
import { FormStrip, HeroIcon, RankMedal } from "./primitives.jsx";
import "./PlayerCard.css";

/**
 * Oyuncu Degerlendirme ekranindaki tek kart.
 *
 * KART SECILEN DONEMI (Hafta / Ay / Son 60) ANLATIR. Ustteki kimlik satiri
 * sabittir; altindaki dort olcut (G/M, MMR degisimi, Performance Rank
 * ortalamasi, mac sayisi), form seridi VE hero seridi pencereye gore degisir.
 * Kartlar puana gore sirali geldigi icin "kim iyi gidiyor" sorusu listenin
 * sirasindan okunur; puanin kendisi de sag ustte durur.
 *
 * ESKIDEN "Tahmini seviye" (potansiyel araligi) yaziyordu. Iki sorunu vardi:
 * bir aralik karsilastirilamiyordu ve donemden bagimsizdi, yani "bu hafta
 * nasil gidiyor" sorusuna hic cevap vermiyordu. Yerini tek bir Performance
 * Rank ortalamasi aldi.
 *
 * NOT: "Performance Rank" GERCEK MMR DEGILDIR; oyuncunun hangi seviyede
 * oynadigina dair tahmindir. Kart bunu her zaman acikca yazar.
 *
 * @param {Object} props
 * @param {Record<string, any>} props.card
 * @param {boolean} props.selected
 * @param {(id: string) => void} props.onSelect
 * @param {boolean} [props.live] Oyuncu su an canli macta mi
 */
export function PlayerCard({ card, selected, onSelect, live = false }) {
  const period = card.period || null;
  const played = Number(period?.matches || 0);
  const hasData = card.hasData !== false;

  // Hero seridi SECILEN DONEMI anlatir: "bu hafta ne oynadi", Son 60'ta "son
  // 60 macta ne oynadi". Kartin geri kalani (G/M, MMR, Performance Rank) zaten donemi
  // gosteriyor; serit genel kalsaydi kart kendi icinde celisirdi.
  //
  // Donem ozeti hic gelmediyse (eski sunucu yaniti) kartin kendi genel
  // dagilimina dusulur — serit bos kalmasin.
  const heroes = (
    period?.topHeroes?.length ? period.topHeroes : card.topHeroes || []
  ).slice(0, PERIOD_HERO_COUNT);

  // Cerceve rengi G/M dengesi, MMR degisimi ve Performance Rank degisiminin
  // birlesiminden gelir — oynanan mac sayisi RENGE KARISMAZ, yoksa cok oynayan
  // herkes yesil gorunurdu. Esik cekirdekte belirleniyor (bkz.
  // core/weekly-score.js -> tone), yoksa iki yerde iki ayri dogru olurdu.
  const tone = period?.ranked ? period.tone : "flat";

  return (
    <button
      type="button"
      className={
        "player-card tone-" +
        tone +
        (selected ? " selected" : "") +
        (live ? " live" : "")
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

        <div className="player-card-rank">
          <RankMedal rank={card.rank} size={38} />
          {period?.ranked ? (
            <span
              className={"player-score " + tone}
              title={
                "Puan " +
                period.score +
                (period.position ? " · " + period.position + ". sıra" : "") +
                " — G/M dengesi, MMR değişimi ve Performance Rank değişiminden hesaplanır (50 nötr)."
              }
            >
              {period.score}
            </span>
          ) : null}
        </div>
      </div>

      {played > 0 ? (
        <>
          <div className="player-card-metrics">
            <Metric
              label="G / M"
              value={
                <span>
                  {period.wins}
                  <span className="muted"> / </span>
                  {period.losses}
                </span>
              }
              hint={formatPercent(period.winRate)}
            />
            <Metric
              label="MMR"
              value={<MmrDelta period={period} />}
              hint={MMR_SOURCE_HINTS[period.mmrSource] || ""}
            />
            <Metric
              label="PR"
              value={
                <span title="Gerçek MMR değil; Performans Rank">
                  {period.performanceRank || "—"}
                </span>
              }
              hint={<PerformanceDelta period={period} />}
            />
            <Metric label="Maç" value={<span>{played}</span>} />
          </div>

          <div className="player-card-form">
            <FormStrip form={period.form || []} max={12} />
          </div>

          <div className="player-card-heroes">
            {heroes.map((row) => (
              <HeroIcon
                key={row.hero}
                hero={row.hero}
                size={26}
                title={
                  row.hero +
                  " · " +
                  row.matches +
                  " maç · " +
                  formatPercent(row.winRate) +
                  (row.avgKda ? " · KDA " + row.avgKda : "")
                }
              />
            ))}
            {!heroes.length ? (
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
      ) : hasData ? (
        // Verisi var ama SECILEN DONEMDE maci yok. "Veri bekleniyor"dan
        // tamamen farkli bir durum: kart dolu, oyuncu yalnizca oynamamis.
        <div className="player-card-pending muted">
          Bu dönemde maç yok.
          {card.fetchedAt ? (
            <span className="micro">
              {" "}
              (son veri: {formatRelativeTime(card.fetchedAt)})
            </span>
          ) : null}
        </div>
      ) : (
        <div className="player-card-pending muted">
          Maç verisi henüz alınmadı. “Yenile”ye bas.
        </div>
      )}
    </button>
  );
}

/**
 * Karttaki tek olcut kutusu.
 *
 * @param {{ label: string, value: React.ReactNode, hint?: React.ReactNode }} props
 */
function Metric({ label, value, hint }) {
  return (
    <div className="player-metric">
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
  estimated: "tahmin",
  none: "",
};

/**
 * @param {{ period: Record<string, any> }} props
 */
function MmrDelta({ period }) {
  const delta = Number(period.mmrDelta) || 0;
  const estimated = period.mmrSource !== "measured";
  return (
    <span
      className={"player-delta " + (delta >= 0 ? "up" : "down")}
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
 * Performance Rank'in onceki doneme gore degisimi.
 *
 * Kiyas verisi yoksa SAYI UYDURULMAZ; "yeni" yazar. Sifir gostermek "degisim
 * olmadi" demek olurdu, oysa soylenen sey "kiyaslayacak sey yok".
 *
 * @param {{ period: Record<string, any> }} props
 */
function PerformanceDelta({ period }) {
  if (period.key === "all") {
    // Pencere elde duran tum maclari kapsiyor; "ondan onceki donem" diye bir
    // sey yok. Ortalamanin NEYIN ortalamasi oldugunu yazmak, bos bir "—"dan
    // daha fazla sey soyluyor.
    return (
      <span title="Bu pencerede kıyaslanacak önceki dönem yoktur">
        son {MATCH_FETCH_SIZE} maç
      </span>
    );
  }
  if (!period.hasBaseline) {
    return <span title="Kıyaslanacak önceki dönem verisi yok">yeni</span>;
  }
  const delta = Number(period.performanceDelta) || 0;
  return (
    <span
      className={"player-delta " + (delta >= 0 ? "up" : "down")}
      title="Önceki döneme göre değişim"
    >
      {delta > 0 ? "+" : ""}
      {delta}
    </span>
  );
}
