import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, SkeletonBlock } from "./primitives.jsx";
import "./SettingsPanel.css";

/**
 * Masaustu uygulamasinin ayar ekrani.
 *
 * NEDEN VAR: kurulum dosyasini indiren kisinin canli mac yayinini acabilmesi
 * icin siteyle paylasilan gizli anahtari girmesi gerekiyor. `/api/settings`
 * ucu bastan beri vardi ama onu cagiran hicbir arayuz yoktu; ayar yalnizca
 * ortam degiskeniyle verilebiliyordu.
 *
 * Yalnizca masaustunde gosterilir (`session.mode === "desktop"`), cunku
 * sitede boyle bir uc yok.
 *
 * Gizli alanlar sunucudan "***" olarak gelir. Kullanici dokunmazsa aynen geri
 * gonderilir ve sunucu onu "degistirilmedi" sayar; boylece anahtar arayuze
 * hic dusmeden korunur.
 */
const SECRET_PLACEHOLDER = "***";

/**
 * @param {{ onClose: () => void }} props
 */
export function SettingsPanel({ onClose }) {
  const loaded = useAsyncData(() => api.settings());

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.data?.settings) {
      setForm(loaded.data.settings);
    }
  }, [loaded.data]);

  /**
   * @param {string} key
   * @param {string|boolean} value
   */
  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      // Dokunulmamis gizli alanlar "***" olarak gider; sunucu bunlari atlar.
      const response = await api.saveSettings(form);
      setForm(response.settings);
      setSaved(true);
    } catch (caught) {
      setError(caught?.message || "Ayarlar kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  if (loaded.loading) {
    return (
      <div className="settings-panel">
        <SkeletonBlock lines={6} height={22} />
      </div>
    );
  }

  if (loaded.error || !form) {
    return (
      <div className="settings-panel">
        <EmptyState
          title="Ayarlar açılamadı"
          detail={loaded.error?.message || "Bilinmeyen hata"}
          action={
            <button type="button" className="btn small" onClick={onClose}>
              Kapat
            </button>
          }
        />
      </div>
    );
  }

  const gsiPort = loaded.data?.gsiPort || 3044;
  const mmrStatus = loaded.data?.mmrStatus || null;

  return (
    <div className="settings-panel">
      <div className="settings-head">
        <div>
          <h3>Ayarlar</h3>
          <p className="muted micro">
            Bu ayarlar yalnızca bu bilgisayardaki masaüstü uygulaması içindir.
          </p>
        </div>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Kapat
        </button>
      </div>

      <section className="settings-group">
        <h4>Canlı maç yayını</h4>
        <p className="muted micro">
          Oyundayken maç durumunu siteye gönderir; arkadaşların canlı maçını
          görebilir. İki alanın da dolu olması gerekir.
        </p>

        <Field
          label="Site adresi"
          hint="Kurulumla birlikte gelir, normalde değiştirmen gerekmez."
          value={form.cloudUrl || ""}
          onChange={(v) => change("cloudUrl", v)}
          placeholder="https://dotastat.netlify.app"
        />

        <Field
          label="Paylaşılan gizli anahtar"
          hint="Netlify'daki LIVE_INGEST_TOKEN ile AYNI değer olmalı."
          value={form.ingestToken || ""}
          onChange={(v) => change("ingestToken", v)}
          type="password"
          placeholder="Netlify'daki değeri yapıştır"
        />

        <Toggle
          label="Canlı maç yayını açık"
          checked={form.shareLive !== false}
          onChange={(v) => change("shareLive", v)}
        />
      </section>

      <section className="settings-group">
        <h4>Kimlik</h4>
        <Field
          label="SteamID"
          hint="Boş bırakırsan oyundan otomatik tespit edilir."
          value={form.steamId || ""}
          onChange={(v) => change("steamId", v)}
          placeholder="76561198…"
        />
        {form.detectedSteamId ? (
          <p className="muted micro">
            Oyundan tespit edilen: <code>{form.detectedSteamId}</code>
          </p>
        ) : null}
      </section>

      <section className="settings-group">
        <h4>Veri kaynakları</h4>
        <p className="muted micro">
          İkisi de isteğe bağlı. OpenDota anahtarsız da çalışır, anahtar
          yalnızca istek limitini yükseltir.
        </p>
        <Field
          label="OpenDota API anahtarı"
          value={form.openDotaApiKey || ""}
          onChange={(v) => change("openDotaApiKey", v)}
          type="password"
        />
        <Field
          label="Stratz API anahtarı"
          hint="OpenDota günlük limite takılınca yedek kaynak."
          value={form.stratzApiKey || ""}
          onChange={(v) => change("stratzApiKey", v)}
          type="password"
        />
      </section>

      {/*
        MMR okuma ve siteye gonderim durumu. Sessizce basarisiz olan bir
        gonderim aylarca fark edilmeyebilir; burada acikca yaziyor.
      */}
      {mmrStatus ? (
        <section className="settings-group">
          <h4>MMR</h4>
          <p className="muted micro">
            {mmrStatus.available
              ? mmrStatus.samples + " okuma kayıtlı."
              : "Kaynak bulunamadı — Overwolf ve MMR uygulaması kurulu ve açık olmalı."}
          </p>
          <p className="muted micro">
            Siteye gönderim:{" "}
            {mmrStatus.upload?.ok ? (
              <span className="chip good">çalışıyor</span>
            ) : (
              <span className="chip warn">
                {mmrStatus.upload?.error || "bilinmiyor"}
              </span>
            )}
          </p>
        </section>
      ) : null}

      <section className="settings-group">
        <h4>Uygulama</h4>
        <Toggle
          label="Açılışta simge durumunda başlat"
          checked={Boolean(form.startMinimized)}
          onChange={(v) => change("startMinimized", v)}
        />
        <Toggle
          label="GSI dosyasını otomatik kur"
          checked={form.autoInstallGsi !== false}
          onChange={(v) => change("autoInstallGsi", v)}
        />
        <p className="muted micro">
          GSI yapılandırması <code>{gsiPort}</code> portunu kullanır.
        </p>
      </section>

      <div className="settings-foot">
        {error ? (
          <span className="chip bad" role="alert">
            {error}
          </span>
        ) : null}
        {saved ? <span className="chip good">Kaydedildi</span> : null}
        <button
          type="button"
          className="btn primary small"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   label: string, value: string, onChange: (value: string) => void,
 *   hint?: string, type?: string, placeholder?: string
 * }} props
 */
function Field({ label, value, onChange, hint, type = "text", placeholder }) {
  // Gizli alan sunucudan "***" gelmisse kullanici tiklayinca temizlenir;
  // boylece yanlislikla "***" degerini kaydetmesi engellenir.
  const isMasked = value === SECRET_PLACEHOLDER;

  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      <input
        className="settings-input"
        type={type}
        value={value}
        placeholder={isMasked ? "kayıtlı — değiştirmek için yaz" : placeholder}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (isMasked) {
            onChange("");
          }
        }}
      />
      {hint ? <span className="muted micro">{hint}</span> : null}
    </label>
  );
}

/**
 * @param {{ label: string, checked: boolean, onChange: (value: boolean) => void }} props
 */
function Toggle({ label, checked, onChange }) {
  return (
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
