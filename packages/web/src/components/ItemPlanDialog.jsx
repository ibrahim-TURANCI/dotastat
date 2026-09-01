import { useEffect, useMemo, useState } from "react";
import { heroDisplayName, itemDisplayName, itemIconUrl } from "@dotastat/core";
import { api } from "../lib/api.js";
import { HeroIcon } from "./primitives.jsx";
import "./ItemPlanDialog.css";

/**
 * "Tavsiyeleri yonet" penceresi.
 *
 * NE ICIN VAR: otomatik tavsiye hero profillerinden turer ve genel gecerdir.
 * Grubun kendi tarzi bunun disina cikabilir — bir hero'da hep alinan bir item
 * planda olmayabilir, ya da plandaki bir item bu grupta hic tutmayabilir.
 * Burada yazilan iki liste motorun onerisini ezer:
 *
 *   EKLE   -> her zaman onerilir, listenin en basinda
 *   CIKAR  -> hicbir zaman onerilmez
 *
 * ERISIM: yalnizca Steam ile giris yapmis kullanici acabilir; kayit anahtari
 * sunucuda oturum cerezinden alinir (bkz. netlify/functions/item-plans.mjs).
 * Bu, son maclardaki pozisyon secimiyle AYNI sozlesmedir.
 *
 * @param {Object} props
 * @param {string} props.hero Duzenlenecek hero anahtari
 * @param {Array<Record<string, any>>} [props.suggested] Motorun su anki onerisi
 * @param {() => void} props.onClose
 * @param {() => void} [props.onSaved] Kayit sonrasi canli paneli tazelemek icin
 */
export function ItemPlanDialog({
  hero,
  suggested = [],
  onClose,
  onSaved = () => {},
}) {
  const [plan, setPlan] = useState({ add: [], remove: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .itemPlans()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const stored = response?.plans?.[hero] || {};
        setPlan({ add: stored.add || [], remove: stored.remove || [] });
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught?.message || "Kayıtlı düzenlemeler okunamadı");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hero]);

  // Motorun onerdigi itemler tek tikla "cikar" listesine atilabilsin diye
  // ayri gosterilir; kullanicinin item anahtarini elle yazmasi gerekmez.
  const suggestedRows = useMemo(
    () =>
      (suggested || []).map((row) => ({
        key: row.key,
        name: row.name || itemDisplayName(row.key),
        reason: row.reason || "",
      })),
    [suggested],
  );

  /**
   * @param {"add"|"remove"} list
   * @param {string} key
   */
  const toggle = (list, key) => {
    const item = String(key || "")
      .trim()
      .toLowerCase()
      .replace(/^item_/, "");
    if (!item) {
      return;
    }
    setPlan((current) => {
      const has = current[list].includes(item);
      const other = list === "add" ? "remove" : "add";
      return {
        // Bir item ayni anda hem eklenip hem cikarilamaz; digerinden dusurulur.
        [other]: current[other].filter((row) => row !== item),
        [list]: has
          ? current[list].filter((row) => row !== item)
          : [...current[list], item],
      };
    });
    setError("");
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.setItemPlan(hero, plan);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught?.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => setPlan({ add: [], remove: [] });

  return (
    <div
      className="plan-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Tavsiyeleri yönet"
      >
        <header className="plan-dialog-head">
          <HeroIcon hero={hero} size={32} />
          <div>
            <strong>{heroDisplayName(hero) || hero}</strong>
            <span className="muted micro">Tavsiyeleri yönet</span>
          </div>
          <button
            type="button"
            className="btn small"
            onClick={onClose}
            aria-label="Kapat"
          >
            Kapat
          </button>
        </header>

        {loading ? (
          <p className="muted">Yükleniyor…</p>
        ) : (
          <>
            <section className="plan-section">
              <h4>Şu an önerilenler</h4>
              <p className="muted micro">
                Tıklayınca <strong>çıkar</strong> listesine geçer ve bir daha
                önerilmez.
              </p>
              <div className="plan-chip-row">
                {suggestedRows.length ? (
                  suggestedRows.map((row) => (
                    <button
                      type="button"
                      key={row.key}
                      className={
                        "plan-chip" +
                        (plan.remove.includes(row.key) ? " removed" : "")
                      }
                      title={row.reason}
                      onClick={() => toggle("remove", row.key)}
                    >
                      <img src={itemIconUrl(row.key)} alt="" loading="lazy" />
                      {row.name}
                    </button>
                  ))
                ) : (
                  <span className="muted micro">
                    Bu hero için şu an öneri üretilmedi.
                  </span>
                )}
              </div>
            </section>

            <section className="plan-section">
              <h4>Her zaman öner ({plan.add.length})</h4>
              <div className="plan-add-row">
                <input
                  value={draft}
                  placeholder="item anahtarı (ör. black_king_bar)"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      toggle("add", draft);
                      setDraft("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    toggle("add", draft);
                    setDraft("");
                  }}
                >
                  Ekle
                </button>
              </div>
              <div className="plan-chip-row">
                {plan.add.length ? (
                  plan.add.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className="plan-chip added"
                      title="Kaldırmak için tıkla"
                      onClick={() => toggle("add", key)}
                    >
                      <img src={itemIconUrl(key)} alt="" loading="lazy" />
                      {itemDisplayName(key)}
                    </button>
                  ))
                ) : (
                  <span className="muted micro">Elle eklenen item yok.</span>
                )}
              </div>
            </section>

            {plan.remove.length ? (
              <section className="plan-section">
                <h4>Hiç önerme ({plan.remove.length})</h4>
                <div className="plan-chip-row">
                  {plan.remove.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className="plan-chip removed"
                      title="Geri almak için tıkla"
                      onClick={() => toggle("remove", key)}
                    >
                      <img src={itemIconUrl(key)} alt="" loading="lazy" />
                      {itemDisplayName(key)}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        <footer className="plan-dialog-foot">
          {error ? (
            <span className="chip bad" role="alert">
              {error}
            </span>
          ) : null}
          <button type="button" className="btn small" onClick={reset}>
            Sıfırla
          </button>
          <button
            type="button"
            className="btn primary small"
            onClick={save}
            disabled={saving || loading}
          >
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </footer>
      </div>
    </div>
  );
}
