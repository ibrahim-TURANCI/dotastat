import { useEffect, useMemo, useRef, useState } from "react";
import { MATCH_FETCH_SIZE, PERIODS, DEFAULT_PERIOD } from "@dotastat/core";
import { api, ROSTER_CHANGED_EVENT } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { PlayerCard } from "../components/PlayerCard.jsx";
import { PlayerDetail } from "../components/PlayerDetail.jsx";
import { PeriodSwitch } from "../components/PeriodSwitch.jsx";
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
 * Son basarili kart listesinin tarayicidaki kopyasi (donem basina).
 *
 * NEDEN: depo gecici olarak okunamadiginda (ornek: Netlify Blobs "Token
 * expired") liste bir hata ekranina donup elde olan veriyi siliyordu. Artik
 * ekranda son basarili hal kalir; sayfa yenilense bile bu kopya gosterilir.
 * Depolama kapaliysa yalnizca bu yedek calismaz, baska bir sey etkilenmez.
 */
const SNAPSHOT_KEY = "dotastat:players-snapshot:";

/** @param {string} period */
function readSnapshot(period) {
  try {
    return JSON.parse(
      window.localStorage.getItem(SNAPSHOT_KEY + period) || "null",
    );
  } catch {
    return null;
  }
}

/**
 * @param {string} period
 * @param {unknown} data
 */
function writeSnapshot(period, data) {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY + period, JSON.stringify(data));
  } catch {
    // Depolama kapali ya da dolu: yedek tutulmaz.
  }
}

/**
 * Kart listesinin ONBELLEK yoklama araligi.
 *
 * Kaynaga gitmez (bkz. asagidaki `players`), yalnizca baskasinin tazeledigi
 * veriyi ekrana tasir. Sunucu yaniti da 60 saniye onbellekleniyor; daha sik
 * yoklamak ayni cevabi tekrar tekrar istemek olurdu.
 *
 * Verisi beklenen oyuncu varken (arka planda dolduruluyor) dakikada bir,
 * yoksa 3 dakikada bir yoklanir: kartlar mac basina degisir ve mac bitisi
 * zaten ayrica tazeleme tetikliyor (bkz. `matchEndedToken`).
 */
const CACHE_POLL_MS = 60000;
const CACHE_POLL_SETTLED_MS = 180000;

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
  // Yoklama hizi bekleyen oyuncu olup olmamasina bagli; deger asagidaki
  // yanittan gelir (bkz. CACHE_POLL_MS).
  const [hasPending, setHasPending] = useState(true);

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
  //
  // Basarili her cevap tarayiciya da yazilir (bkz. SNAPSHOT_KEY).
  const players = useAsyncData(
    async (options) => {
      const data = await api.players({ ...options, period });
      writeSnapshot(period, data);
      return data;
    },
    {
      intervalMs: hasPending ? CACHE_POLL_MS : CACHE_POLL_SETTLED_MS,
      deps: [period],
    },
  );
  // Okuma hatasinda ekrandaki veri korunur: hook son basarili veriyi tutar,
  // sayfa yeni acildiysa tarayicidaki kopya kullanilir. Hata MESAJI
  // gosterilmez; yoklama bir sonraki turda kendiliginden tekrar dener.
  // Hook'taki veri BASKA bir doneme aitse (donem degisti, yeni okuma henuz
  // gelmedi ya da basarisiz) o donemin tarayici kopyasi tercih edilir.
  const current = players.data?.period === period ? players.data : null;
  const snapshot = useMemo(
    () => (current ? null : readSnapshot(period)),
    [current, period],
  );
  const view = current || snapshot || players.data;

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

  // Kadro Debug panelinden degisti (oyuncu eklendi / gizlendi / silindi):
  // liste CDN'in 60 saniyelik kopyasini atlayarak hemen tazelenir.
  useEffect(() => {
    const onRosterChanged = () => players.reload({ fresh: true });
    window.addEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
    return () =>
      window.removeEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TOPLU "Yenile" YOK: oyuncular tek tek, detay panelindeki "Yenile" ile
  // tazelenir; boylece gerekmeyen oyuncu icin istek harcanmaz. Detaydaki
  // tazeleme bu listeye hemen yansir (bkz. onDataChanged).
  const lastFetchedAt = view?.lastFetchedAt || "";

  const cards = view?.cards || [];
  const pending = view?.pendingPlayers || [];

  const pendingNow = !players.data || pending.length > 0;
  useEffect(() => {
    setHasPending(pendingNow);
  }, [pendingNow]);
  const liveIds = new Set(liveKnownPlayerIds);

  return (
    <CollapsibleSection
      title="Oyuncu Değerlendirme"
      subtitle={periodSubtitle(period, view?.periodDays)}
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
        </>
      }
    >
      {!view && players.loading ? (
        <SkeletonBlock lines={4} height={92} />
      ) : !view ? (
        // Ne sunucudan ne tarayicidan veri var (ilk acilis + depo hatasi).
        // Teknik hata metni gosterilmez; yoklama kendiliginden tekrar dener.
        <EmptyState
          title="Oyuncu verisi şu an okunamıyor"
          detail="Bağlantı düzelince liste kendiliğinden yüklenecek."
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
          // Genel sekmesinin ozeti listede secili donemle acilir.
          period={period}
          onClose={() => setSelected("")}
          // Detayda "Yenile"ye basildiginda ayni veri kartlari da degistirir;
          // listeyi eski haliyle birakmak "hangisi dogru" sorusunu doguruyordu.
          // `fresh`: CDN'deki eski kopya atlanir, yeni mac aninda gorunur.
          onDataChanged={() => players.reload({ fresh: true })}
          // Kadroda yeni veri gelince detay da onbellekten yeniden okunur.
          dataVersion={lastFetchedAt}
        />
      ) : null}
    </CollapsibleSection>
  );
}
