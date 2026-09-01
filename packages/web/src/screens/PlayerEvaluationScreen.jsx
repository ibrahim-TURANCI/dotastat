import { useState } from "react";
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
 * Oyuncu Degerlendirme ekrani — sitenin ana ekrani.
 *
 * Kartlar acilista onbellekten gelir; verisi olmayan oyuncular arka planda
 * doldurulur, bu yuzden panel "beklemede" olanlari da gosterir.
 *
 * Katlanabilir ve VARSAYILAN OLARAK ACIKTIR; canli mac basladiginda uygulama
 * kabugu bunu kapatir ki ekranda mac one ciksin (bkz. App.jsx).
 *
 * @param {{ liveKnownPlayerIds?: string[], open?: boolean, onToggle?: () => void }} props
 */
export function PlayerEvaluationScreen({
  liveKnownPlayerIds = [],
  open = true,
  onToggle = () => {},
}) {
  const [selected, setSelected] = useState("");

  // Otomatik yoklama YOK. Oyuncu verisi yalnizca ilk acilista bir kez, sonra
  // da kullanici "Yenile" dedikce cekilir. Onceden 3 dakikada bir (ve sekmeye
  // her donuste) istek atiliyordu; bu OpenDota gunluk limitini bosa
  // harciyordu. Canli mac paneli ayri bir uctan beslenir, o pollamaya devam
  // eder — orada tazelik gercekten gerekli.
  const players = useAsyncData((options) => api.players(options));

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
      subtitle="Performance Rank ve seviye tahminleri gerçek MMR değildir; oyun verisinden çıkarılan tahminlerdir."
      open={open}
      onToggle={onToggle}
      right={
        <>
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
        <PlayerDetail playerKey={selected} onClose={() => setSelected("")} />
      ) : null}
    </CollapsibleSection>
  );
}
