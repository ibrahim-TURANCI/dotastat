import { useEffect, useMemo, useState } from "react";
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

/**
 * Uygulama kabugu.
 *
 * Ekran duzeni sabittir:
 *   1. Ust bar (kimlik, online, indirme)
 *   2. Haftanin Kazanani / Kaybedeni (son 7 gun)
 *   3. Oyuncu Degerlendirme
 *   4. Canli Mac (+ draft asistani)
 *   5. Debug Panel (kapali akordeon)
 */
export default function App() {
  const session = useSession();
  // Ayar ekrani yalnizca masaustunde vardir; sitede boyle bir uc yok.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const live = useAsyncData(() => api.live(session.user?.steamId || ""), {
    intervalMs: LIVE_POLL_MS,
    deps: [session.user?.steamId || ""],
  });

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

      <WeeklyLeaderboard />

      <PlayerEvaluationScreen
        liveKnownPlayerIds={live.data?.knownPlayerIds || []}
      />

      <LiveMatchPanel
        live={live.data}
        loading={live.loading}
        error={live.error}
      />

      <DebugPanel live={live.data} user={session.user} />

      <footer className="app-footer muted micro">
        DotaStat · veri kaynağı OpenDota + Dota 2 Game State Integration ·
        gösterilen seviye tahminleri gerçek MMR değildir
      </footer>
    </div>
  );
}
