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
  // Masaustunde: siteye Steam ile giris yapilmis mi (artik ZORUNLU DEGIL).
  const [cloudSignedIn, setCloudSignedIn] = useState(false);
  // Masaustunde: ayarlarda site adresi tanimli mi. Tanimli degilse Steam
  // giris penceresi hic acilamaz, bu yuzden arayuz onden uyarir.
  const [cloudConfigured, setCloudConfigured] = useState(true);
  // Masaustunde: giris yapilmadan da siteye bagli mi (cihaz kimligi). Site
  // bu cihazi reddettiyse `cloudRejected` acilir ve bir kez giris gerekir.
  const [cloudLinked, setCloudLinked] = useState(false);
  const [cloudRejected, setCloudRejected] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const payload = await api.session();
      setUser(payload.signedIn ? payload.user : null);
      setMode(String(payload.mode || "cloud"));
      setCloudSignedIn(Boolean(payload.cloudSignedIn));
      setCloudConfigured(payload.cloudConfigured !== false);
      setCloudLinked(Boolean(payload.cloudLinked));
      setCloudRejected(Boolean(payload.cloudRejected));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Masaustunde site baglantisi kendiliginden degisir: SteamID ilk macta
  // tespit edilir, site cihazi reddedebilir. Yerel bir istek, ucuz.
  useEffect(() => {
    if (mode !== "desktop") {
      return undefined;
    }
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [mode, load]);

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

  return {
    user,
    mode,
    cloudSignedIn,
    cloudConfigured,
    cloudLinked,
    cloudRejected,
    loading,
    reload: load,
    logout,
  };
}
