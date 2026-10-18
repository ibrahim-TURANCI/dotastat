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

        <Toggle
          label="Overwolf'tan canlı draft oku"
          checked={form.useOverwolf !== false}
          onChange={(v) => change("useOverwolf", v)}
        />
        <p className="muted micro">
          Overwolf + DotaPlus kuruluysa rakip takımın pickleri ve rank bilgisi
          de yayına eklenir; GSI canlı maçta yalnızca kendi oyuncunu verir.
          Kurulu değilse bu ayarın hiçbir etkisi olmaz.
        </p>
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
          label="Bilgisayar açılınca başlat"
          checked={form.autoLaunch !== false}
          onChange={(v) => change("autoLaunch", v)}
        />
        <p className="muted micro">
          Oturum açıldığında pencere açılmadan tepside başlar. Yalnızca kurulu
          sürümde geçerlidir.
        </p>
        <Toggle
          label="Açılışta simge durumunda başlat"
          checked={form.startMinimized !== false}
          onChange={(v) => change("startMinimized", v)}
        />
        <Toggle
          label="Oyun içinde draft önerilerini göster"
          checked={form.showDraftOverlay !== false}
          onChange={(v) => change("showDraftOverlay", v)}
        />
        <p className="muted micro">
          Hero seçimi ve strateji süresi boyunca ekranın sağında pozisyon başına
          önerilen hero'lar ve puanları görünür.
        </p>
        <Toggle
          label="Oyun içinde item tavsiyesi göster"
          checked={form.showItemOverlay !== false}
          onChange={(v) => change("showItemOverlay", v)}
        />
        <p className="muted micro">
          Maç sürerken sağ altta sıradaki 4 item önerisi görünür. Dota'nın
          görüntü modu “Kenarlıksız pencere” olmalı; tam ekran modunda hiçbir
          uygulama oyunun üstüne çizilemez.
        </p>
        {form.showItemOverlay !== false ? (
          <ItemOverlaySettings form={form} change={change} />
        ) : null}
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
 * Item seridinin dizilimleri; olculer 1080p'de piksel. Masaustundeki overlay
 * penceresiyle (packages/desktop/src/services/overlay.js -> ITEM_LAYOUTS)
 * AYNI olmali.
 */
const ITEM_LAYOUTS = [
  { key: "horizontal", label: "Yatay", width: 188, height: 32, cols: 4 },
  { key: "vertical", label: "Dikey", width: 44, height: 140, cols: 1 },
  { key: "grid", label: "2x2", width: 92, height: 68, cols: 2 },
];
/** Zula panelinin ustu; daha asagisi Dota'nin HUD'una biner. */
const ITEM_MIN_HEIGHT = 19;
/** Ekranin ustundeki ag bilgisi (FPS / ping) alani; serit buraya cikamaz. */
const TOP_RESERVED = 7;
const OPACITY_MIN = 15;
const OPACITY_MAX = 100;

/**
 * Dizilime gore secilebilecek en yuksek konum (%): seridin ust kenari ag
 * bilgisi alaninin altinda kalir.
 * @param {{ height: number }} layout
 */
function maxItemHeight(layout) {
  return Math.floor(100 - TOP_RESERVED - (layout.height / 1080) * 100);
}

/**
 * Item tavsiyesi seridinin dizilim, yukseklik ve opaklik ayarlari ile
 * ekranin sag kenarini temsil eden on izleme.
 *
 * @param {{ form: Record<string, any>, change: (key: string, value: any) => void }} props
 */
function ItemOverlaySettings({ form, change }) {
  const layout =
    ITEM_LAYOUTS.find((row) => row.key === form.itemOverlayLayout) ||
    ITEM_LAYOUTS[0];
  const max = maxItemHeight(layout);
  const height = Math.min(
    max,
    Math.max(
      ITEM_MIN_HEIGHT,
      Number(form.itemOverlayHeight) || ITEM_MIN_HEIGHT,
    ),
  );
  const opacity = Math.min(
    OPACITY_MAX,
    Math.max(OPACITY_MIN, Number(form.itemOverlayOpacity ?? 75)),
  );

  /** @param {typeof ITEM_LAYOUTS[number]} next */
  function pickLayout(next) {
    change("itemOverlayLayout", next.key);
    // Yeni dizilim daha uzunsa konum ag bilgisi alanina tasmasin.
    if (height > maxItemHeight(next)) {
      change("itemOverlayHeight", maxItemHeight(next));
    }
  }

  return (
    <div className="overlay-settings">
      <div className="overlay-settings-controls">
        <div className="settings-field">
          <span className="settings-label">Dizilim</span>
          <div className="overlay-layouts" role="radiogroup">
            {ITEM_LAYOUTS.map((row) => (
              <button
                key={row.key}
                type="button"
                role="radio"
                aria-checked={row.key === layout.key}
                className={
                  "btn small" + (row.key === layout.key ? " primary" : " ghost")
                }
                onClick={() => pickLayout(row)}
              >
                {row.label}
              </button>
            ))}
          </div>
        </div>

        <label className="settings-field">
          <span className="settings-label">Yükseklik: %{height}</span>
          <input
            type="range"
            min={ITEM_MIN_HEIGHT}
            max={max}
            step={1}
            value={height}
            onChange={(event) =>
              change("itemOverlayHeight", Number(event.target.value))
            }
          />
          <span className="muted micro">
            Ekranın altından uzaklık. %{ITEM_MIN_HEIGHT} Zula'nın hemen üstü; en
            üstteki ağ bilgisi alanına çıkamaz.
          </span>
        </label>

        <label className="settings-field">
          <span className="settings-label">Opaklık: %{opacity}</span>
          <input
            type="range"
            min={OPACITY_MIN}
            max={OPACITY_MAX}
            step={5}
            value={opacity}
            onChange={(event) =>
              change("itemOverlayOpacity", Number(event.target.value))
            }
          />
        </label>
      </div>

      <OverlayPreview layout={layout} height={height} opacity={opacity} />
    </div>
  );
}

/** On izlemede temsil edilen ekran dilimi: 1080p'nin sagdaki 600 pikseli. */
const PREVIEW_SCALE = 0.3;
const px = (value) => Math.round(value * PREVIEW_SCALE);

/**
 * Ekranin sag kenarinin basit bir cizimi: ag bilgisi, sesli komut yazisi,
 * Zula, alttaki HUD ve item tavsiyesinin secilen konumu.
 *
 * @param {{ layout: typeof ITEM_LAYOUTS[number], height: number, opacity: number }} props
 */
function OverlayPreview({ layout, height, opacity }) {
  return (
    <div
      className="overlay-preview"
      style={{ width: px(600), height: px(1080) }}
      aria-label="Item tavsiyesinin ekrandaki konumu"
    >
      <div
        className="op-zone op-reserved"
        style={{ height: (TOP_RESERVED / 100) * px(1080) }}
      />
      <div
        className="op-zone op-network"
        style={{ top: px(6), right: px(8), width: px(200), height: px(46) }}
      >
        Ağ
      </div>
      <div
        className="op-zone op-voice"
        style={{ top: px(640), right: px(8), width: px(150), height: px(36) }}
      >
        Sesli komut
      </div>
      <div
        className="op-zone op-stash"
        style={{ bottom: px(130), right: 0, width: px(300), height: px(74) }}
      >
        Zula
      </div>
      <div className="op-zone op-hud" style={{ height: px(130) }}>
        HUD · hızlı alım
      </div>
      <div
        className="op-items"
        style={{
          bottom: (height / 100) * px(1080),
          width: px(layout.width),
          height: px(layout.height),
          gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
          opacity: opacity / 100,
        }}
      >
        {[0, 1, 2, 3].map((index) => (
          <span key={index} />
        ))}
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
