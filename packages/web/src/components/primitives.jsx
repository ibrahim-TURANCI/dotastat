import { useEffect, useId, useState } from "react";
import {
  heroDisplayName,
  heroImageUrl,
  ROLE_SHORT_LABELS,
} from "@dotastat/core";

/**
 * Tekrar kullanilan kucuk arayuz parcalari.
 * Buyuk paneller bu dosyadaki bilesenlerin uzerine kurulur.
 */

/**
 * Varsayilan olarak KAPALI acordeon. Basliga tiklaninca acilir.
 *
 * @param {Object} props
 * @param {string} props.title
 * @param {string} [props.hint] Baslikta saga yaslanan kucuk not
 * @param {boolean} [props.defaultOpen]
 * @param {React.ReactNode} props.children
 */
export function Accordion({ title, hint, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="accordion" data-open={open}>
      <button
        type="button"
        className="accordion-trigger"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="row" style={{ gap: 8 }}>
          <span className="accordion-caret" aria-hidden="true">
            ▶
          </span>
          {title}
        </span>
        {hint ? <span className="muted">{hint}</span> : null}
      </button>
      {open ? (
        <div className="accordion-body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Katlanabilir ana bolum.
 *
 * `Accordion`dan farki: baslik, alt baslik ve sagdaki rozetlerle birlikte
 * bolumun NORMAL gorunumunu korur — yalnizca basliga tiklanabilirlik ve bir
 * ok eklenir. Boylece bolumler kapatilabilir hale gelirken ekran duzeni
 * degismez.
 *
 * DENETIMLIDIR (`open` disaridan verilir): canli mac basladiginda uygulama
 * kabugu bolumleri kendisi katlar. Kullanici sonra istedigini yine acabilir;
 * bu yuzden durum tek bir yerde, App'te tutulur.
 *
 * Govde kapaliyken CIZILMEZ. Bu bilincli: kapali bir bolum veri cekmeye ya da
 * yoklamaya devam etmemeli.
 *
 * @param {Object} props
 * @param {string} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {React.ReactNode} [props.right] Baslikta saga yaslanan icerik
 * @param {boolean} props.open
 * @param {() => void} props.onToggle
 * @param {string} [props.className] Bolume eklenecek ek sinif
 * @param {React.ReactNode} props.children
 */
export function CollapsibleSection({
  title,
  subtitle,
  right,
  open,
  onToggle,
  className = "",
  children,
}) {
  const bodyId = useId();

  return (
    <section
      className={("section collapsible-section " + className).trim()}
      data-open={open ? "true" : "false"}
    >
      <div className="section-head">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="section-caret" aria-hidden="true">
            ▶
          </span>
          <span>
            <h2 className="section-title">{title}</h2>
            {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
          </span>
        </button>
        {right ? (
          <div className="row" style={{ gap: 8 }}>
            {right}
          </div>
        ) : null}
      </div>
      {open ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}

/**
 * Hero ikonu. Gorsel yuklenmezse hero adinin bas harfleri gosterilir.
 *
 * @param {{ hero: string, size?: number, title?: string }} props
 */
export function HeroIcon({ hero, size = 34, title }) {
  const [failed, setFailed] = useState(false);
  const name = heroDisplayName(hero);
  const label = title || name || "Bilinmiyor";

  useEffect(() => {
    setFailed(false);
  }, [hero]);

  if (!hero || failed) {
    return (
      <span
        className="hero-icon hero-icon-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size / 3) }}
        title={label}
      >
        {name ? name.slice(0, 2).toUpperCase() : "?"}
      </span>
    );
  }

  return (
    <img
      className="hero-icon"
      src={heroImageUrl(hero, "icon")}
      alt={label}
      title={label}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

const RANK_MEDAL_CDN =
  "https://www.opendota.com/assets/images/dota2/rank_icons";

/**
 * Dota rank madalyasi. `rank` yoksa hicbir sey cizmez.
 *
 * @param {{ rank: { medal: number, stars: number, label: string }|null, size?: number }} props
 */
export function RankMedal({ rank, size = 34 }) {
  if (!rank || !Number(rank.medal)) {
    return null;
  }

  const medal = Number(rank.medal);
  const stars = Number(rank.stars || 0);

  return (
    <span
      className="rank-medal"
      style={{ width: size, height: size }}
      title={rank.label}
    >
      <img
        src={RANK_MEDAL_CDN + "/rank_icon_" + medal + ".png"}
        alt={rank.label}
      />
      {stars > 0 ? (
        <img
          className="rank-star"
          src={RANK_MEDAL_CDN + "/rank_star_" + stars + ".png"}
          alt=""
        />
      ) : null}
    </span>
  );
}

/**
 * Son maclarin galibiyet/maglubiyet seridi.
 * @param {{ form: Array<"win"|"loss">, max?: number }} props
 */
export function FormStrip({ form = [], max = 10 }) {
  const rows = form.slice(0, max);
  if (!rows.length) {
    return <span className="muted">form verisi yok</span>;
  }

  return (
    <span className="form-strip" aria-label="son maclar">
      {rows.map((result, index) => (
        <i
          key={index}
          className={"form-dot " + (result === "win" ? "win" : "loss")}
          title={result === "win" ? "Galibiyet" : "Maglubiyet"}
        />
      ))}
    </span>
  );
}

/**
 * 0-100 arasi puanin halka gostergesi.
 *
 * Halka koyu kirmizidan neon yesile giden bir gradyanla dolar: dusuk puan
 * yalnizca kirmizi ucu gosterir, yuksek puan yesile kadar uzanir. Yani renk
 * DEGERIN KENDISINI anlatir; ortadaki sayi ayni bilgiyi renge bakmadan da
 * verir (renk ayrimi zor olan kullanici icin).
 *
 * `tone` puanin yonu (bkz. core -> weekly-score tone); yalnizca sayinin
 * rengini ve hafif parlamayi belirler.
 *
 * @param {{ value: number, tone?: "up"|"down"|"flat", size?: number, title?: string }} props
 */
export function ScoreRing({ value, tone = "flat", size = 44, title }) {
  const score = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <span
      className={"score-ring tone-" + tone}
      style={{ "--p": score, width: size, height: size }}
      role="img"
      aria-label={"Puan " + score + " / 100"}
      title={title}
    >
      <span className="score-ring-value" aria-hidden="true">
        {score}
      </span>
    </span>
  );
}

/**
 * Pozisyon rozeti (Pos 1-5), her pozisyon kendi renginde.
 *
 * Yesil ve kirmizi BILEREK kullanilmaz: o iki renk ekranda zaten
 * galibiyet/maglubiyet demek; pozisyon rozeti onlarla karismamali.
 *
 * @param {{ role: string, label?: string, small?: boolean, title?: string }} props
 */
export function RoleBadge({ role, label, small = false, title }) {
  const known = Object.prototype.hasOwnProperty.call(ROLE_SHORT_LABELS, role);
  return (
    <span
      className={
        "role-badge role-" + (known ? role : "unknown") + (small ? " small" : "")
      }
      title={title}
    >
      {label || ROLE_SHORT_LABELS[role] || role}
    </span>
  );
}

/**
 * Yukari / asagi okla degisim (MMR, Performance Rank).
 *
 * Isaret (+/-) yerine ok kullanilir; ekran okuyucu icin yon ayrica yazilir.
 * `approximate` tahmini degerlerin basina "~" koyar. `tone` verilirse RENK
 * ondan gelir (ok yine isarete gore): cekirdek kucuk degisimleri esikle
 * "sabit" sayiyorsa renk de notr kalmali.
 *
 * @param {{ value: number, approximate?: boolean, pill?: boolean, tone?: "up"|"down"|"flat", title?: string }} props
 */
export function DeltaArrow({
  value,
  approximate = false,
  pill = false,
  tone,
  title,
}) {
  const delta = Math.round(Number(value) || 0);
  const direction = tone || (delta > 0 ? "up" : delta < 0 ? "down" : "flat");
  return (
    <span
      className={"delta-arrow " + direction + (pill ? " pill" : "")}
      title={title}
    >
      <span className="delta-arrow-icon" aria-hidden="true">
        {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"}
      </span>
      <span className="sr-only">
        {delta > 0 ? "artış " : delta < 0 ? "düşüş " : "değişim yok "}
      </span>
      {approximate ? "~" : ""}
      {Math.abs(delta)}
    </span>
  );
}

/**
 * @param {{ trend: "up"|"down"|"flat" }} props
 */
export function TrendBadge({ trend }) {
  const map = {
    up: { text: "↑ yukselise gecti", className: "chip good" },
    down: { text: "↓ dususte", className: "chip bad" },
    flat: { text: "→ sabit", className: "chip" },
  };
  const row = map[trend] || map.flat;
  return <span className={row.className}>{row.text}</span>;
}

/**
 * @param {{ lines?: number, height?: number }} props
 */
export function SkeletonBlock({ lines = 3, height = 16 }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="skeleton"
          style={{ height, width: index % 3 === 2 ? "62%" : "100%" }}
        />
      ))}
    </div>
  );
}

/**
 * @param {{ title: string, detail?: string, action?: React.ReactNode }} props
 */
export function EmptyState({ title, detail, action }) {
  return (
    <div className="empty-state stack" style={{ alignItems: "center" }}>
      <strong style={{ color: "var(--txt-1)" }}>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {action}
    </div>
  );
}
