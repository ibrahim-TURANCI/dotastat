import { useEffect, useRef, useState } from "react";
import { MATCH_FETCH_SIZE, PERIODS, DEFAULT_PERIOD } from "@dotastat/core";
import { api } from "../lib/api.js";
import { formatRelativeTime } from "../lib/format.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { PlayerCard } from "../components/PlayerCard.jsx";
import { PlayerDetail, refreshTooltip } from "../components/PlayerDetail.jsx";
import {
  CollapsibleSection,
  EmptyState,
  SkeletonBlock,
} from "../components/primitives.jsx";

/**
 * Bolum basliginin altindaki aciklama.
 *
 * "Son 60" sekmesinde "son N gun" YAZILMAZ: o sekme bir takvim penceresi
 * degil, onbellekte duran maclarin tamami. "Son 0 gün" yazmak ya da uydurma bir
 * gun sayisi vermek, sekmenin ne olctugu konusunda yanlis bir sey soylerdi.
 * Sayi `MATCH_FETCH_SIZE`ten gelir; onbellek penceresi degisirse metin de
 * kendiliginden degisir.
 *
 * @param {string} period
 * @param {number} [days] Sunucunun bildirdigi gun sayisi
 * @returns {string}
 */
function periodSubtitle(period, days) {
  const tail =
    " · puana göre sıralı. Performance Rank gerçek MMR değildir; oyun verisinden çıkarılan tahmindir.";
  if (period === PERIODS.all.key) {
    return "Elde duran son " + MATCH_FETCH_SIZE + " maç" + tail;
  }
  return "Son " + (days || PERIODS[period].days) + " gün" + tail;
}

/**
 * Kart listesinin ONBELLEK yoklama araligi.
 *
 * Kaynaga gitmez (bkz. asagidaki `players`), yalnizca baskasinin tazeledigi
 * veriyi ekrana tasir. Sunucu yaniti da 60 saniye onbellekleniyor; daha sik
 * yoklamak ayni cevabi tekrar tekrar istemek olurdu.
 */
const CACHE_POLL_MS = 60000;

/**
 * Hafta / Ay / Son 60 secici.
 *
 * Dugmeler, acilir liste degil: secenek sayisi az ve hepsi tek tikla
 * erisilebilir olmali — hangisinde oldugun da bakmadan gorunmeli.
 *
 * @param {{ value: string, onChange: (value: string) => void }} props
 */
function PeriodSwitch({ value, onChange }) {
  return (
    <div className="period-switch" role="group" aria-label="Dönem">
      {Object.values(PERIODS).map((row) => (
        <button
          key={row.key}
          type="button"
          className={"period-btn" + (value === row.key ? " on" : "")}
          aria-pressed={value === row.key}
          onClick={() => onChange(row.key)}
        >
          {row.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Oyuncu Degerlendirme ekrani — sitenin ana ekrani.
 *
 * Kartlar acilista onbellekten gelir; verisi olmayan oyuncular arka planda
 * doldurulur, bu yuzden panel "beklemede" olanlari da gosterir.
 *
 * DONEM SECIMI (Hafta / Ay): kartlardaki puan, G/M, MMR degisimi ve
 * Performance Rank secilen pencereye gore hesaplanir ve kartlar PUANA GORE
 * siralanir. Eskiden ayni sayilar ayri bir "Haftanin Kazanani / Kaybedeni"
 * bolumunde duruyordu; ayni bilgiyi iki ayri duzende gostermek yerine artik
 * kartlarin kendisi tasiyor — kim iyi gidiyor sorusu listenin sirasindan
 * okunuyor.
 *
 * Katlanabilir ve VARSAYILAN OLARAK ACIKTIR; canli mac basladiginda uygulama
 * kabugu bunu kapatir ki ekranda mac one ciksin (bkz. App.jsx).
 *
 * @param {{
 *   liveKnownPlayerIds?: string[],
 *   matchEndedToken?: string,
 *   open?: boolean,
 *   onToggle?: () => void
 * }} props
 */
export function PlayerEvaluationScreen({
  liveKnownPlayerIds = [],
  matchEndedToken = "",
  open = true,
  onToggle = () => {},
}) {
  const [selected, setSelected] = useState("");
  const [period, setPeriod] = useState(DEFAULT_PERIOD);

  // YOKLAMA VAR AMA KAYNAGA GITMEZ.
  //
  // Kartlar ORTAK onbellekten okunur: birisi (bir arkadas, ya da mac bitince
  // masaustu uygulamasi) veriyi tazelediginde yeni hal depoya yazilir. Bu
  // yoklama onu ekrana tasir — yoksa herkesin ayri ayri sayfayi yenilemesi
  // gerekiyordu.
  //
  // Istek `refresh` TASIMAZ: OpenDota'ya gidilmez, yalnizca onbellek okunur,
  // dolayisiyla gunluk limitten harcamaz. Ayni sebeple donem degistirmek de
  // ucuzdur — sunucu ayni onbellegi baska bir pencereyle ozetler.
  const players = useAsyncData(
    (options) => api.players({ ...options, period }),
    {
      intervalMs: CACHE_POLL_MS,
      deps: [period],
    },
  );

  // Mac BITTIGINDE bir kez kaynaktan tazelenir: yeni mac tam o anda olusur ve
  // onbellekte henuz yoktur. Sunucudaki ortak bekleme suresi (5 dakika) ayni
  // anda bakan herkesin ayri ayri istek atmasini zaten engelliyor.
  const seenMatchEnd = useRef(matchEndedToken);
  useEffect(() => {
    if (!matchEndedToken || matchEndedToken === seenMatchEnd.current) {
      return;
    }
    seenMatchEnd.current = matchEndedToken;
    players.reload({ refresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchEndedToken]);

  // Tazeleme kisisel degil ORTAK bir eylem: onbellek paylasildigi icin biri
  // az once tazelediyse ayni veri yeniden cekilmez. Buton bu yuzden verinin
  // yasina gore kapanir, kisi basina sayaca gerek yok.
  const waitMs = players.data?.refreshAvailableInMs || 0;
  const lastFetchedAt = players.data?.lastFetchedAt || "";

  const cards = players.data?.cards || [];
  const pending = players.data?.pendingPlayers || [];
  // Verisi DURAN ama tazelenemeyen oyuncular. "Bekleyen"den ayri gosterilir:
  // ekrandaki sayilar gecerli, yalnizca eski.
  const stale = players.data?.stalePlayers || [];
  const liveIds = new Set(liveKnownPlayerIds);

  return (
    <CollapsibleSection
      title="Oyuncu Değerlendirme"
      subtitle={periodSubtitle(period, players.data?.periodDays)}
      open={open}
      onToggle={onToggle}
      right={
        <>
          <PeriodSwitch value={period} onChange={setPeriod} />
          {pending.length ? (
            <span className="chip warn">
              {pending.length} oyuncu verisi bekleniyor
            </span>
          ) : null}
          {stale.length ? (
            <span
              className="chip"
              title="Kaynak yeni veri döndürmedi (günlük limit ya da geçici sorun). Ekrandaki değerler geçerli, yalnızca eski."
            >
              {stale.length} oyuncunun verisi tazelenemedi
            </span>
          ) : null}
          {lastFetchedAt ? (
            <span className="muted micro">
              son güncelleme: {formatRelativeTime(lastFetchedAt)}
            </span>
          ) : null}
          <button
            type="button"
            className="btn small"
            onClick={() => players.reload({ refresh: true })}
            disabled={players.refreshing || waitMs > 0}
            title={refreshTooltip(waitMs, players.refreshing)}
          >
            {players.refreshing ? "Yenileniyor…" : "Yenile"}
          </button>
        </>
      }
    >
      {players.loading ? (
        <SkeletonBlock lines={4} height={92} />
      ) : players.error ? (
        <EmptyState
          title="Oyuncu listesi alınamadı"
          detail={players.error.message}
          action={
            <button
              type="button"
              className="btn small"
              onClick={players.reload}
            >
              Tekrar dene
            </button>
          }
        />
      ) : (
        <div className="player-grid">
          {cards.map((card) => (
            <PlayerCard
              key={card.id}
              card={card}
              selected={selected === card.id}
              live={liveIds.has(card.id)}
              onSelect={(id) =>
                setSelected((current) => (current === id ? "" : id))
              }
            />
          ))}
        </div>
      )}

      {selected ? (
        <PlayerDetail
          playerKey={selected}
          onClose={() => setSelected("")}
          // Detayda "Yenile"ye basildiginda ayni veri kartlari da degistirir;
          // listeyi eski haliyle birakmak "hangisi dogru" sorusunu doguruyordu.
          onDataChanged={() => players.reload()}
          // Kadroda yeni veri gelince detay da onbellekten yeniden okunur.
          dataVersion={lastFetchedAt}
        />
      ) : null}
    </CollapsibleSection>
  );
}
