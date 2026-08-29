import { useEffect, useId, useState } from "react";
import { heroDisplayName, heroImageUrl } from "@dotastat/core";

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
