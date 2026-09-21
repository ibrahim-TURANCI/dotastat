import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api.js";
import { useAsyncData } from "./hooks/useAsyncData.js";
import { useSession } from "./hooks/useSession.js";
import { AppHeader } from "./components/AppHeader.jsx";
import { HeroManagerDialog } from "./components/HeroManagerDialog.jsx";
import { LiveMatchPanel } from "./components/LiveMatchPanel.jsx";
import { DebugPanel } from "./components/DebugPanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { PlayerEvaluationScreen } from "./screens/PlayerEvaluationScreen.jsx";

/**
 * Canli mac ne siklikta sorgulanir.
 *
 * Iki hiz var cunku bekleme halinin bedeli gorunmuyordu: acik duran her sekme,
 * ortada mac olmasa bile dakikada 12 fonksiyon cagrisi uretiyordu. Gunun
 * neredeyse tamami bu halde geciyor.
 *
 * Mac BASLADIGINDA hiz 5 saniyeye cikar; skorun gecikmesinin onemli oldugu tek
 * an orasi. Bekleme halinde 20 saniye, "mac basladi" bilgisinin en gec 20
 * saniyede gorunmesi demek — panel zaten kendiliginden acilip one geliyor,
 * kullanicinin ekrana bakiyor olmasi gerekmiyor.
 */
const LIVE_POLL_MS = 5000;
const LIVE_POLL_IDLE_MS = 20000;

/** Bolumlerin mac YOKKEN aldigi durum. */
const IDLE_PANELS = { evaluation: true, live: false };

/** Mac BASLADIGINDA aldigi durum: mac one cikar, digeri katlanir. */
const LIVE_PANELS = { evaluation: false, live: true };

/**
 * Uygulama kabugu.
 *
 * Bolumlerin acik/kapali durumu BURADA tutulur, cunku canli mac basladiginda
 * hepsi birden yer degistirir: mac acilir, digerleri katlanir. Karar tek bir
 * yerde olmazsa bolumler birbirinden habersiz kalir.
 *
 * KURULUMA GORE ICERIK
 * --------------------
 * Masaustu uygulamasi oyunun yaninda, oyun sirasinda acik durur; oraya
 * bakmanin sebebi her zaman o anki mactir. Oyuncu degerlendirme ekrani orada
 * hic GORUNMEZ — ayni veri sitede, daha genis bir ekranda zaten var ve
 * masaustunun isi maci gostermek (ve GSI verisini siteye gondermek).
 *
 * Site ise cogu zaman mac disinda aciliyor — kim nasil gidiyor diye bakmak
 * icin. Orada ust sirayi oyuncu kartlari alir, canli mac altta kalir (zaten
 * mac basladiginda kendiliginden acilip ustundeki bolum katlaniyor).
 *
 *   Masaustu : Canli Mac
 *   Site     : Oyuncu Degerlendirme → Canli Mac → Debug
 */
export default function App() {
  const session = useSession();
  // Ayar ekrani yalnizca masaustunde vardir; sitede boyle bir uc yok.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Hero tavsiye katalogu tek bir yerden yonetiliyor (ust bardaki dugme).
  const [heroManagerOpen, setHeroManagerOpen] = useState(false);
  const [panels, setPanels] = useState(IDLE_PANELS);
  // Yoklama hizi durum olarak tutulur cunku `live` hook'u asagida kuruluyor:
  // sonucu, kendisini besleyen araligi belirliyor.
  const [livePollMs, setLivePollMs] = useState(LIVE_POLL_IDLE_MS);

  const live = useAsyncData(
    (options) => api.live(session.user?.steamId || "", options),
    {
      intervalMs: livePollMs,
      deps: [session.user?.steamId || ""],
    },
  );

  // Masaustunde oyuncu degerlendirme ekrani HIC kurulmaz (bkz. asagidaki
  // `showEvaluation`); duzen kararlari da buna gore veriliyor.
  const isDesktop = session.mode === "desktop";

  const liveActive = Boolean(live.data?.active);
  const previousLiveActive = useRef(liveActive);
  // Mac BITTIGINDE degisen bir isaret. Degerlendirme ekrani bunu gorunce
  // kartlari tazeler: yeni mac verisi tam o anda olusur ve kullanicinin
  // sayfayi yenilemesini beklemenin anlami yok.
  const [matchEndedToken, setMatchEndedToken] = useState("");

  // Yalnizca GECISTE mudahale edilir (mac basladi / bitti). Aksi halde her
  // yoklamada duzen sifirlanir ve kullanicinin actigi bolum kapanirdi —
  // "istenirse tekrar acilir" sartini bozardi.
  useEffect(() => {
    if (liveActive === previousLiveActive.current) {
      return;
    }
    previousLiveActive.current = liveActive;
    if (!liveActive) {
      setMatchEndedToken(new Date().toISOString());
    }
    // Masaustunde ekrandaki TEK bolum canli mac; mac bitince katlamanin
    // anlami yok, geriye bos bir sayfa kalirdi.
    setPanels(liveActive || isDesktop ? LIVE_PANELS : IDLE_PANELS);
    // Aralik degisince hook zamanlayiciyi kurup HEMEN bir istek atar; mac
    // basladiginda ilk hizli yoklama boylece 20 saniye beklemez.
    setLivePollMs(liveActive ? LIVE_POLL_MS : LIVE_POLL_IDLE_MS);
  }, [liveActive, isDesktop]);

  // Masaustunde canli mac bolumu acik baslar: degerlendirme ekrani yok, aksi
  // halde uygulama katlanmis tek bir baslikla aciliyordu.
  useEffect(() => {
    if (isDesktop) {
      setPanels(LIVE_PANELS);
    }
  }, [isDesktop]);

  /** @param {"evaluation"|"live"} key */
  const toggle = (key) =>
    setPanels((current) => ({ ...current, [key]: !current[key] }));

  // Steam donusunden sonra adres cubugundaki ?login=... parametresi temizlenir.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("login")) {
      url.searchParams.delete("login");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.pathname + url.search);
      session.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Giris yapilmamissa kimlik canli mactan tahmin edilir: kadrodaki bir
  // oyuncu oyundaysa ust barda onun adi gorunur.
  const detectedPlayer = useMemo(() => {
    if (session.user || !live.data?.active) {
      return null;
    }
    const all = [
      ...(live.data.radiantPlayers || []),
      ...(live.data.direPlayers || []),
    ];
    const known = all.find((row) => row.roster);
    return known
      ? { name: known.roster.name, hero: known.hero, team: known.team }
      : null;
  }, [session.user, live.data]);

  // Tavsiye katalogu arkadas grubunun ORTAK oyun bilgisi: kimin hangi hero'da
  // ne aldigi, neye karsi ne alindigi. Gruba ait olmayan bir ziyaretcinin orada
  // duzenleyecegi bir sey yok, bu yuzden dugme hic gorunmez. Sunucu da ayni
  // sarti bagimsiz olarak uyguluyor (bkz. netlify/functions/hero-plans.mjs).
  //
  // Masaustunde Steam OpenID akisi yok; kimlik ayarlardaki SteamID ve sunucu
  // kadro kontrolunu yapip sonucu canli mac yanitinda bildiriyor.
  const canManageHeroes =
    session.mode === "desktop"
      ? Boolean(live.data?.canEditItemPlans)
      : Boolean(session.user?.inRoster);

  // `mode` oturum yaniti gelene kadar bos olur; o kisa anda degerlendirme
  // ekrani cizilmez, boylece masaustunde kartlar bir an gorunup kaybolmaz.
  const showEvaluation = Boolean(session.mode) && !isDesktop;

  const evaluationSection = (
    <PlayerEvaluationScreen
      key="evaluation"
      liveKnownPlayerIds={live.data?.knownPlayerIds || []}
      matchEndedToken={matchEndedToken}
      open={panels.evaluation}
      onToggle={() => toggle("evaluation")}
    />
  );

  const liveSection = (
    <LiveMatchPanel
      key="live"
      live={live.data}
      loading={live.loading}
      error={live.error}
      open={panels.live}
      onToggle={() => toggle("live")}
    />
  );

  return (
    <div className="app-shell">
      <AppHeader
        user={session.user}
        sessionLoading={session.loading}
        onLogout={session.logout}
        detectedPlayer={detectedPlayer}
        mode={session.mode}
        cloudSignedIn={session.cloudSignedIn}
        cloudConfigured={session.cloudConfigured}
        onOpenSettings={() => setSettingsOpen((open) => !open)}
        onOpenHeroManager={
          canManageHeroes ? () => setHeroManagerOpen(true) : null
        }
      />

      {heroManagerOpen && canManageHeroes ? (
        <HeroManagerDialog
          onClose={() => setHeroManagerOpen(false)}
          // Kayit sonrasi canli panel hemen tazelenir; yoksa degisiklik
          // sunucunun bir dakikalik hafizasi dolana kadar gorunmezdi.
          onSaved={() => live.reload({ freshPlans: true })}
        />
      ) : null}

      {settingsOpen && session.mode === "desktop" ? (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      ) : null}

      {showEvaluation ? evaluationSection : null}
      {liveSection}

      <DebugPanel live={live.data} user={session.user} />

      <footer className="app-footer muted micro">
        DotaStat · veri kaynağı OpenDota + Dota 2 Game State Integration ·
        gösterilen seviye tahminleri gerçek MMR değildir
      </footer>
    </div>
  );
}
