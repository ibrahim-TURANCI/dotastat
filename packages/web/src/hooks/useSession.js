import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * Sekme arka plandayken heartbeat araligi. Tarayici arka plan zamanlayicilarini
 * dakika sinirina kadar geciktirebiliyor; en kotu durumda bile sunucudaki
 * 3 dakikalik omrun altinda kalir (bkz. _lib/presence.mjs PRESENCE_TTL_MS).
 */
const HIDDEN_BEAT_MS = 100000;

/**
 * Steam oturumu.
 *
 * Giris yapilmissa kullanicinin adi/avatari buradan gelir ve kullanici online
 * listesinde gorunur. Giris yapilmamissa uygulama yine calisir; kimlik o
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

  // ONLINE LISTESI — surekli heartbeat YOK.
  //
  // Sekme gorunurken canli mac yoklamasi zaten gidiyor; sunucu giris yapmis
  // kullanicinin o istegini "buradayim" sayar ve yanit listeyi tasir (bkz.
  // App.jsx, netlify/functions/_lib/presence.mjs). Burada yalnizca iki is var:
  //   - Sekme ARKA PLANDAYKEN yoklama durur; kullanici listeden dusmesin diye
  //     seyrek bir heartbeat gider.
  //   - Sayfa kapanirken tek bir "ayrildim" istegi: listeden aninda duser.
  // Masaustunde liste yereldir, bu adimlara gerek yok.
  useEffect(() => {
    if (!user || mode !== "cloud") {
      return undefined;
    }

    let timer = null;
    const beat = () => api.heartbeat({}).catch(() => {});
    const sync = () => {
      const hidden = document.visibilityState !== "visible";
      if (hidden && !timer) {
        timer = setInterval(beat, HIDDEN_BEAT_MS);
      } else if (!hidden && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onPageHide = () => api.leavePresence();
    // Geri/ileri onbelleginden donuldu: "ayrildim" gitmisti, yeniden katil.
    const onPageShow = (event) => {
      if (event.persisted) {
        beat();
      }
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      if (timer) {
        clearInterval(timer);
      }
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [user, mode]);

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
