import { useState } from "react";
import { api, startSteamLogin } from "../lib/api.js";
import { formatBytes } from "../lib/format.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import "./AppHeader.css";

/**
 * Overwolf + MMR uygulamasinin birlikte kurulum baglantisi.
 *
 * Maç basina MMR degisimi (+26 / -21) yalnizca bu ikisi kuruluyken okunabilir;
 * masaustu uygulamasi degeri onlarin ciktisindan alir.
 */
const OVERWOLF_INSTALL_URL =
  "https://download.overwolf.com/install/Download?ExtensionId=fbdknfcamajbipmgdhhbopcicfakdkcloiaiohnh&Channel=web_dl_btn&utm_content=new-light&utm_source=web_app_store";

/**
 * Ust bar: kimlik, online arkadaslar ve masaustu surumu indirme.
 *
 * Sol ustteki profil artik tahmine dayanmaz: Steam ile giris yapildiginda
 * kimlik dogrulanmis olarak gelir. Giris yapilmamissa oyuna girildiginde
 * canli mac verisinden profil eslestirilmeye devam edilir.
 *
 * @param {Object} props
 * @param {{ name: string, avatar: string, steamId: string, inRoster: boolean }|null} props.user
 * @param {boolean} props.sessionLoading
 * @param {() => void} props.onLogout
 * @param {{ name: string, hero: string, team: string }|null} props.detectedPlayer
 */
export function AppHeader({
  user,
  sessionLoading,
  onLogout,
  detectedPlayer,
  mode,
  cloudSignedIn,
  cloudConfigured,
  onOpenSettings,
}) {
  const presence = useAsyncData(() => api.presence(), { intervalMs: 45000 });
  const release = useAsyncData(() => api.release(), { intervalMs: 0 });

  const online = presence.data?.online || [];
  const download = release.data?.download || null;

  return (
    <header className="app-header">
      <div className="app-header-brand">
        <span className="app-logo" aria-hidden="true">
          DS
        </span>
        <div>
          <h1>DotaStat</h1>
          <p className="muted">Oyuncu degerlendirme ve canli mac paneli</p>
        </div>
      </div>

      <div className="app-header-side">
        <OnlineStrip online={online} loading={presence.loading} />

        {download ? (
          <a
            className="btn small"
            href={download.url}
            title={
              "Sürüm " +
              (release.data?.version || "?") +
              " · " +
              formatBytes(download.sizeBytes)
            }
          >
            ⬇ Masaüstü sürümü
          </a>
        ) : null}

        {/*
          MMR degeri hicbir genel API'de yok; yalnizca Overwolf'un oyun ici
          saglayicisindan geliyor. Bu baglanti Overwolf'u ve MMR'i okuyan
          uygulamayi birlikte kurar (bkz. services/mmr-watcher.js).
        */}
        <a
          className="btn small"
          href={OVERWOLF_INSTALL_URL}
          title="Maç başına MMR değişimini görmek için gerekli"
        >
          ⬇ MMR için Overwolf
        </a>

        {mode === "desktop" ? (
          <button
            type="button"
            className="btn ghost small"
            onClick={onOpenSettings}
          >
            ⚙ Ayarlar
          </button>
        ) : null}

        <IdentityBox
          user={user}
          loading={sessionLoading}
          onLogout={onLogout}
          detectedPlayer={detectedPlayer}
          mode={mode}
          cloudSignedIn={cloudSignedIn}
          cloudConfigured={cloudConfigured}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </header>
  );
}

/**
 * @param {{ online: Array<Record<string, any>>, loading: boolean }} props
 */
function OnlineStrip({ online, loading }) {
  if (loading) {
    return <span className="muted">online listesi yükleniyor…</span>;
  }

  if (!online.length) {
    return <span className="chip">Şu an online kimse yok</span>;
  }

  return (
    <div className="online-strip" title="Şu an sitede olan arkadaşlar">
      <span className="online-dot" aria-hidden="true" />
      <span className="muted">{online.length} online</span>
      <div className="online-avatars">
        {online.slice(0, 6).map((row) => (
          <span key={row.steamId} className="online-avatar" title={row.name}>
            {row.avatar ? (
              <img src={row.avatar} alt={row.name} />
            ) : (
              <i>
                {String(row.name || "?")
                  .slice(0, 1)
                  .toUpperCase()}
              </i>
            )}
            {row.inGame ? <b className="online-ingame" title="Oyunda" /> : null}
          </span>
        ))}
        {online.length > 6 ? (
          <span className="online-avatar more">+{online.length - 6}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Record<string, any>|null} props.user
 * @param {boolean} props.loading
 * @param {() => void} props.onLogout
 * @param {{ name: string, hero: string }|null} props.detectedPlayer
 */
function IdentityBox({
  user,
  loading,
  onLogout,
  detectedPlayer,
  mode,
  cloudSignedIn,
  cloudConfigured,
  onOpenSettings,
}) {
  if (loading) {
    return <span className="muted">oturum kontrol ediliyor…</span>;
  }

  // MASAUSTU DALI EN BASTA: kimlik oyundan okununca `user` doluyor ve bu
  // kontrol asagida kalsaydi (kaldi da) asagidaki `if (user)` kazanip site
  // giris butonunu hic cizmiyordu. Yani oyuna bir kez girmis olan kullanici
  // "Steam ile giris"i BIR DAHA goremiyordu.
  //
  // Masaustunde iki ayri kimlik var ve ikisi de gosterilmeli:
  //   - OYUNDAN okunan SteamID (otomatik, yerel kullanim icin)
  //   - SITE oturumu (canli mac + MMR yayini icin; elle bir kez yapilir)
  if (mode === "desktop") {
    return (
      <DesktopIdentity
        user={user}
        detectedPlayer={detectedPlayer}
        cloudSignedIn={cloudSignedIn}
        cloudConfigured={cloudConfigured}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  if (user) {
    return (
      <div className="identity-box">
        {user.avatar ? (
          <img className="identity-avatar" src={user.avatar} alt={user.name} />
        ) : (
          <span className="identity-avatar placeholder">
            {String(user.name || "?")
              .slice(0, 1)
              .toUpperCase()}
          </span>
        )}
        <div className="identity-text">
          <strong>{user.name}</strong>
          <span className="muted">
            {user.inRoster ? "Kadroda" : "Steam ile giriş yapıldı"}
          </span>
        </div>
        <button type="button" className="btn ghost small" onClick={onLogout}>
          Çıkış
        </button>
      </div>
    );
  }

  return (
    <div className="identity-box">
      {detectedPlayer ? (
        <div className="identity-text">
          <strong>{detectedPlayer.name}</strong>
          <span className="muted">oyundan tespit edildi</span>
        </div>
      ) : null}
      <button
        type="button"
        className="btn primary small"
        onClick={startSteamLogin}
      >
        <SteamMark /> Steam ile giriş
      </button>
    </div>
  );
}

/**
 * Masaustundeki kimlik kutusu.
 *
 * IKI AYRI KIMLIK VAR, karistirilmamali:
 *
 *   1. OYUNDAN OKUNAN SteamID — GSI her maçta `localSteamId` gonderiyor,
 *      uygulama onu ayarlara yaziyor. Bu OTOMATIKTIR, giris gerektirmez ve
 *      kendi profilini/pozisyon secimini acan sey budur.
 *
 *   2. SITE OTURUMU — canli maci ve MMR'i siteye gonderebilmek icin gerekir.
 *      Bu OTOMATIK OLAMAZ: Steam kimligi yalnizca sitenin OpenID akisindan
 *      gecerek kanitlanir. Oyun, sitenin guvenebilecegi bir belge vermiyor;
 *      verseydi herkes istedigi SteamID adina veri gonderebilirdi (eski
 *      paylasilan-anahtar yonteminin terk edilme sebebi tam olarak buydu).
 *      Cerez 30 gun gecerlidir, yani ayda bir giris yeterli.
 *
 * @param {{
 *   user: Record<string, any>|null,
 *   detectedPlayer: { name: string }|null,
 *   cloudSignedIn: boolean,
 *   onOpenSettings?: () => void
 * }} props
 */
function DesktopIdentity({
  user,
  detectedPlayer,
  cloudSignedIn,
  cloudConfigured = true,
  onOpenSettings,
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = user?.name || detectedPlayer?.name || "";
  // Site adresi yoksa giris penceresi acilamaz; bunu TIKLAMADAN once soyle.
  const blocked = !cloudSignedIn && !cloudConfigured;

  /**
   * Giris penceresini acar ve SONUCU GOSTERIR.
   *
   * Onceden sonuc yok sayiliyordu: site adresi bos oldugunda ana surec
   * `{ ok: false, error: "site-adresi-yok" }` donuyor ama arayuz bunu
   * okumadigi icin butona basmak HICBIR SEY yapmiyor gibi gorunuyordu.
   */
  async function signIn() {
    setError("");
    setBusy(true);
    try {
      const result = await window.dotastat?.cloudLogin?.();
      if (!result) {
        setError("Giriş başlatılamadı.");
      } else if (!result.ok && result.error !== "iptal") {
        setError(LOGIN_ERRORS[result.error] || "Giriş yapılamadı.");
      }
    } catch (caught) {
      setError(String(caught?.message || caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="identity-box desktop">
      <div className="identity-text">
        {name ? (
          <>
            <strong>{name}</strong>
            <span className="muted">oyundan tespit edildi</span>
          </>
        ) : (
          <span className="muted">Kimlik oyundan okunur</span>
        )}
        {error || blocked ? (
          <span
            className={"chip identity-error " + (error ? "bad" : "warn")}
            role={error ? "alert" : "status"}
          >
            {error || LOGIN_ERRORS["site-adresi-yok"]}
            {onOpenSettings ? (
              <button
                type="button"
                className="link-button"
                onClick={onOpenSettings}
              >
                Ayarları aç
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      {cloudSignedIn ? (
        <button
          type="button"
          className="btn ghost small"
          onClick={() => window.dotastat?.cloudLogout?.()}
          title="Canlı maç ve MMR yayını için site oturumu açık. Kapatmak için tıkla."
        >
          ✓ Site oturumu açık
        </button>
      ) : (
        <button
          type="button"
          className="btn primary small"
          onClick={signIn}
          disabled={busy}
          title="Canlı maçını ve MMR'ını arkadaşlarının görebilmesi için gerekli"
        >
          <SteamMark /> {busy ? "Giriş açılıyor…" : "Steam ile giriş"}
        </button>
      )}
    </div>
  );
}

/** Ana surecin dondurdugu hata kodlarinin okunabilir karsiligi. */
const LOGIN_ERRORS = {
  "site-adresi-yok":
    "Önce Ayarlar → Site adresi alanına sitenin adresini yaz (https://... ).",
  "giris-basarisiz": "Steam girişi tamamlanmadı, tekrar dene.",
};

function SteamMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-9.96 9.2l5.37 2.22a2.83 2.83 0 0 1 1.6-.5h.14l2.39-3.46v-.05a3.78 3.78 0 1 1 3.78 3.78h-.09l-3.4 2.43v.11a2.84 2.84 0 0 1-5.63.47l-3.84-1.59A10 10 0 1 0 12 2Zm-3.2 15.1 1.23.51a2.15 2.15 0 1 0 1.2-2.83l1.27.53a1.58 1.58 0 1 1-1.22 2.91l-2.48-1.12Zm6.52-4.35a2.52 2.52 0 1 0 0-5.03 2.52 2.52 0 0 0 0 5.03Zm0-.63a1.89 1.89 0 1 1 0-3.78 1.89 1.89 0 0 1 0 3.78Z"
      />
    </svg>
  );
}
