import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api.js";
import { useAsyncData } from "./hooks/useAsyncData.js";
import { useSession } from "./hooks/useSession.js";
import { AppHeader } from "./components/AppHeader.jsx";
import { LiveMatchPanel } from "./components/LiveMatchPanel.jsx";
import { DebugPanel } from "./components/DebugPanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { WeeklyLeaderboard } from "./components/WeeklyLeaderboard.jsx";
import { PlayerEvaluationScreen } from "./screens/PlayerEvaluationScreen.jsx";

/** Canli mac ne siklikta sorgulanir. */
const LIVE_POLL_MS = 5000;

/** Bolumlerin mac YOKKEN aldigi durum. */
const IDLE_PANELS = { weekly: true, evaluation: true, live: false };

/** Mac BASLADIGINDA aldigi durum: mac one cikar, digerleri katlanir. */
const LIVE_PANELS = { weekly: false, evaluation: false, live: true };

/**
 * Uygulama kabugu.
 *
 * Bolumlerin acik/kapali durumu BURADA tutulur, cunku canli mac basladiginda
 * hepsi birden yer degistirir: mac acilir, digerleri katlanir. Karar tek bir
 * yerde olmazsa bolumler birbirinden habersiz kalir.
 *
 * SIRALAMA KURULUMA GORE DEGISIR
 * ------------------------------
 * Masaustu uygulamasi oyunun yaninda, oyun sirasinda acik durur; oraya
 * bakmanin sebebi neredeyse her zaman o anki mactir. Bu yuzden masaustunde
 * Canli Mac EN USTTEDIR.
 *
 * Site ise cogu zaman mac disinda aciliyor — kim nasil gidiyor diye bakmak
 * icin. Orada ust sirayi haftalik tablo ve oyuncu kartlari hak ediyor, canli
 * mac altta kaliyor (zaten mac basladiginda kendiliginden acilip ustundeki
 * iki bolum katlaniyor).
 *
 *   Masaustu : Canli Mac → Haftanin Kazanani → Oyuncu Degerlendirme → Debug
 *   Site     : Haftanin Kazanani → Oyuncu Degerlendirme → Canli Mac → Debug
 */
export default function App() {
  const session = useSession();
  // Ayar ekrani yalnizca masaustunde vardir; sitede boyle bir uc yok.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panels, setPanels] = useState(IDLE_PANELS);

  const live = useAsyncData(() => api.live(session.user?.steamId || ""), {
    intervalMs: LIVE_POLL_MS,
    deps: [session.user?.steamId || ""],
  });

  const liveActive = Boolean(live.data?.active);
  const previousLiveActive = useRef(liveActive);

  // Yalnizca GECISTE mudahale edilir (mac basladi / bitti). Aksi halde her
  // yoklamada duzen sifirlanir ve kullanicinin actigi bolum kapanirdi —
  // "istenirse tekrar acilir" sartini bozardi.
  useEffect(() => {
    if (liveActive === previousLiveActive.current) {
      return;
    }
    previousLiveActive.current = liveActive;
    setPanels(liveActive ? LIVE_PANELS : IDLE_PANELS);
  }, [liveActive]);

  /** @param {"weekly"|"evaluation"|"live"} key */
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

  // Masaustunde canli mac en uste alinir. `mode` oturum yaniti gelene kadar
  // bos olur; o kisa anda site duzeni kullanilir, sonra tek seferde yerine
  // oturur.
  const liveFirst = session.mode === "desktop";

  const weeklySection = (
    <WeeklyLeaderboard
      key="weekly"
      open={panels.weekly}
      onToggle={() => toggle("weekly")}
    />
  );

  const evaluationSection = (
    <PlayerEvaluationScreen
      key="evaluation"
      liveKnownPlayerIds={live.data?.knownPlayerIds || []}
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
      />

      {settingsOpen && session.mode === "desktop" ? (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      ) : null}

      {liveFirst
        ? [liveSection, weeklySection, evaluationSection]
        : [weeklySection, evaluationSection, liveSection]}

      <DebugPanel live={live.data} user={session.user} />

      <footer className="app-footer muted micro">
        DotaStat · veri kaynağı OpenDota + Dota 2 Game State Integration ·
        gösterilen seviye tahminleri gerçek MMR değildir
      </footer>
    </div>
  );
}
