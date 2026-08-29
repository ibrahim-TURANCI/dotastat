import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * Steam oturumu.
 *
 * Giris yapilmissa kullanicinin adi/avatari buradan gelir ve online listesine
 * heartbeat gonderilir. Giris yapilmamissa uygulama yine calisir; kimlik o
 * durumda yalnizca canli mactaki SteamID uzerinden tahmin edilir.
 */
export function useSession() {
  const [user, setUser] = useState(null);
  // "desktop" | "cloud" — masaustunde Steam OpenID akisi yoktur, arayuz buna
  // gore "Steam ile giris" yerine "Ayarlar" gosterir.
  const [mode, setMode] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const payload = await api.session();
      setUser(payload.signedIn ? payload.user : null);
      setMode(String(payload.mode || "cloud"));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Giris yapan kullanici online listesinde gorunur kalsin.
  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const beat = () => {
      api.heartbeat({}).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, 60000);
    return () => clearInterval(timer);
  }, [user]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Cerez zaten gecersizse sessizce devam.
    }
    setUser(null);
  }, []);

  return { user, mode, loading, reload: load, logout };
}
