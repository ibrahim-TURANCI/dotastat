import { useState } from "react";
import { api } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { PlayerCard } from "../components/PlayerCard.jsx";
import { PlayerDetail } from "../components/PlayerDetail.jsx";
import { EmptyState, SkeletonBlock } from "../components/primitives.jsx";

/**
 * Oyuncu Degerlendirme ekrani — sitenin ana ekrani.
 *
 * Kartlar acilista onbellekten gelir; verisi olmayan oyuncular arka planda
 * doldurulur, bu yuzden panel "beklemede" olanlari da gosterir.
 *
 * @param {{ liveKnownPlayerIds?: string[] }} props
 */
export function PlayerEvaluationScreen({ liveKnownPlayerIds = [] }) {
  const [selected, setSelected] = useState("");

  // Otomatik yoklama YOK. Oyuncu verisi yalnizca ilk acilista bir kez, sonra
  // da kullanici "Yenile" dedikce cekilir. Onceden 3 dakikada bir (ve sekmeye
  // her donuste) istek atiliyordu; bu OpenDota gunluk limitini bosa
  // harciyordu. Canli mac paneli ayri bir uctan beslenir, o pollamaya devam
  // eder — orada tazelik gercekten gerekli.
  const players = useAsyncData((options) => api.players(options));

  // Sunucu saatte 5 tazelemeye izin veriyor. Sinira takilinca butonu kapatip
  // sebebini yaziyoruz; sessizce basarisiz olmasi kafa karistirirdi.
  const [limitNotice, setLimitNotice] = useState("");

  async function handleRefresh() {
    setLimitNotice("");
    const result = await players.reload({ refresh: true });
    if (result?.error?.code === "cok-fazla-yenileme") {
      setLimitNotice(result.error.message);
    }
  }

  const cards = players.data?.cards || [];
  const pending = players.data?.pendingPlayers || [];
  const liveIds = new Set(liveKnownPlayerIds);

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Oyuncu Değerlendirme</h2>
          <p className="section-subtitle">
            Performance Rank ve seviye tahminleri gerçek MMR değildir; oyun
            verisinden çıkarılan tahminlerdir.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {pending.length ? (
            <span className="chip warn">
              {pending.length} oyuncu verisi bekleniyor
            </span>
          ) : null}
          {limitNotice ? (
            <span className="chip bad" role="alert">
              {limitNotice}
            </span>
          ) : null}
          <button
            type="button"
            className="btn small"
            onClick={handleRefresh}
            disabled={players.refreshing || Boolean(limitNotice)}
            title="Veri kaynağının günlük kotası paylaşıldığı için saatte 5 kez"
          >
            {players.refreshing ? "Yenileniyor…" : "Yenile"}
          </button>
        </div>
      </div>

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
    </section>
  );
}
