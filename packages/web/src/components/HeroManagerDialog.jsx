import { useEffect, useMemo, useState } from "react";
import {
  editedHeroKeys,
  heroCatalog,
  heroDisplayName,
  heroKeys,
  heroPrimaryAttribute,
  itemDisplayName,
  itemIconUrl,
  searchHeroes,
  searchItems,
  HERO_ATTRIBUTES,
  HERO_ATTRIBUTE_LABELS,
  LANE_ROLES,
  LANE_ROLE_LABELS,
  ROLE_VALUE_KEYS,
  ROLE_VALUE_LABELS,
  TRAIT_KEYS,
  TRAIT_LABELS,
  TRAIT_TOOLTIPS,
} from "@dotastat/core";
import { api } from "../lib/api.js";
import { Combobox } from "./Combobox.jsx";
import { HeroIcon } from "./primitives.jsx";
import "./HeroManagerDialog.css";

/**
 * "Tavsiyeleri yönet" penceresi.
 *
 * NE ICIN VAR: otomatik tavsiye uretilmis tohum veriden turer ve genel
 * gecerdir. Grubun kendi tarzi bunun disina cikabilir — bir hero'da hep alinan
 * bir item planda olmayabilir, ya da plandaki bir item bu grupta hic tutmaz.
 * Burada yazilanlar motorun kullandigi kaydi ezer.
 *
 * NEDEN TEK BIR PENCERE, OYUNCU BASINA DEGIL: onceki surumde her canli mac
 * satirinda ayri bir "Tavsiyeleri yonet" dugmesi vardi. Duzenleme oyuncunun
 * degil HERO'NUN kaydina yaziliyordu, yani dugmenin satirda durmasi yanlis bir
 * sey vaat ediyordu; ustelik hero'yu duzenlemek icin o hero'nun canli bir
 * macta olmasi gerekiyordu. Artik tum katalog her zaman acilabiliyor.
 *
 * IKI EKRAN
 *   1. Liste  : ana ozellige (Ozellik) ya da lane rolune (Pozisyon) gore
 *               gruplanmis hero'lar + arama kutusu
 *   2. Detay  : bir hero'ya tiklaninca acilir; roller, counter listeleri ve
 *               item planlari
 *
 * ERISIM: pencere yalnizca KADRODAKI oyunculara aciliyor (bkz. App.jsx) ve
 * sunucu ayni sarti bagimsiz olarak uyguluyor (bkz. hero-plans.mjs). Katalog
 * arkadas grubunun ortak oyun bilgisi; gruba ait olmayan birinin duzenleyecegi
 * bir sey yok.
 *
 * VARSAYILAN: "N hero duzenlenmis" ve vurgu, gecerli duzenlemenin VARSAYILAN
 * kayittan farkini gosterir. Katalog yoneticisi (catalogAdmin) basliktaki
 * "Kaydet" ile gecerli duzenlemeleri varsayilan yapar; isaretler sifirlanir
 * ve yalnizca SONRAKI duzenlemeler gorunur. Dugme yalnizca ona ve yalnizca
 * duzenlenmis hero varken gorunur; sunucu da ayni yetkiyi uygular.
 *
 * @param {Object} props
 * @param {() => void} props.onClose
 * @param {() => void} [props.onSaved] Kayit sonrasi canli paneli tazelemek icin
 */
export function HeroManagerDialog({ onClose, onSaved }) {
  /** hero -> kullanicinin kaydettigi duzenleme. */
  const [plans, setPlans] = useState({});
  /** hero -> varsayilan duzenleme ("Kaydet" anindaki). */
  const [defaults, setDefaults] = useState({});
  const [canSaveDefaults, setCanSaveDefaults] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  // Masaustunde site erisilemezse duzenleme yerelde bekler; kullanici bunu
  // bilmeli, yoksa "kaydettim" sanip siteye gitmedigini fark etmez.
  const [syncNote, setSyncNote] = useState("");
  // Yalnizca GERCEKTEN bir istek atilacaksa yukleniyor durumundan baslanir.
  // Giris yapmamis kullanici icin okunacak bir kayit yok ve katalog zaten
  // pakette; "Yukleniyor…" yazip sonra listeyi acmak bos bir bekleme olurdu.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [view, setView] = useState(DEFAULT_VIEW);

  useEffect(() => {
    let cancelled = false;
    api
      .heroPlans()
      .then((response) => {
        if (!cancelled) {
          apply(response);
          setError("");
        }
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
  }, []);

  // Katalog tohum veri + duzenlemenin birlesimi ve YALNIZCA duzenleme
  // degistiginde yeniden kurulur; 127 hero'luk bir tabloyu her tusa basista
  // yeniden uretmek arama kutusunu hissedilir sekilde yavaslatiyordu.
  const catalog = useMemo(() => heroCatalog(plans), [plans]);
  // Varsayilandan farkli hero'lar: baslik sayisi ve vurgu bunu gosterir.
  const edited = useMemo(
    () => new Set(editedHeroKeys(plans, defaults)),
    [plans, defaults],
  );

  const groups = useMemo(
    () =>
      view === "attribute" ? groupByAttribute(catalog) : groupByLane(catalog),
    [catalog, view],
  );

  /** Sunucu yanitini duruma yazar. */
  function apply(response) {
    setPlans(response?.heroes || {});
    setDefaults(response?.defaults || {});
    setSyncNote(response?.synced === false ? response?.message || "" : "");
    if (typeof response?.canSaveDefaults === "boolean") {
      setCanSaveDefaults(response.canSaveDefaults);
    }
  }

  const needle = query.trim().toLocaleLowerCase("tr");
  const matches = (hero) =>
    !needle ||
    hero.toLocaleLowerCase("tr").includes(needle) ||
    heroDisplayName(hero).toLocaleLowerCase("tr").includes(needle);

  /**
   * Bir hero'nun kaydini yazar; bos govde kaydi siler.
   * @param {string} hero
   * @param {Record<string, any>|null} patch
   */
  const save = async (hero, patch) => {
    apply(await api.setHeroPlan(hero, patch || {}));
    onSaved?.();
  };

  /** Gecerli duzenlemeleri varsayilan yapar (yalnizca katalog yoneticisi). */
  const saveDefaults = async () => {
    if (
      !window.confirm(
        edited.size +
          " hero'nun düzenlemesi varsayılan olarak kaydedilecek. Devam edilsin mi?",
      )
    ) {
      return;
    }
    setSavingDefaults(true);
    setError("");
    try {
      apply(await api.saveHeroDefaults());
    } catch (caught) {
      setError(caught?.message || "Varsayılan kaydedilemedi");
    } finally {
      setSavingDefaults(false);
    }
  };

  return (
    <div
      className="hero-manager-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="hero-manager"
        role="dialog"
        aria-modal="true"
        aria-label="Tavsiyeleri yönet"
      >
        <header className="hero-manager-head">
          <div>
            <strong>Tavsiyeleri yönet</strong>
            <span className="muted micro">
              {edited.size} hero düzenlenmiş · {HERO_COUNT} hero
            </span>
          </div>
          <ViewSwitch value={view} onChange={setView} />
          <div className="hero-manager-search">
            <span className="combobox-icon" aria-hidden="true">
              🔎
            </span>
            <input
              value={query}
              placeholder="Hero ara… (sf, qop, pudge)"
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            {query ? (
              <button
                type="button"
                className="hero-manager-clear"
                onClick={() => setQuery("")}
                aria-label="Aramayı temizle"
              >
                ×
              </button>
            ) : null}
          </div>
          {/* Yalnizca kaydedilecek bir degisiklik varken gorunur. */}
          {canSaveDefaults && edited.size ? (
            <button
              type="button"
              className="btn small hero-manager-save"
              disabled={savingDefaults}
              onClick={saveDefaults}
              title="Düzenlenmiş hero'ları varsayılan olarak kaydet; işaretler sıfırlanır"
            >
              {savingDefaults ? "Kaydediliyor…" : "Kaydet"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn small"
            onClick={onClose}
            aria-label="Kapat"
          >
            Kapat
          </button>
        </header>

        {error ? (
          <p className="chip bad" role="alert">
            {error}
          </p>
        ) : null}
        {syncNote ? (
          <p className="chip warn" role="status">
            {syncNote}
          </p>
        ) : null}

        {loading ? (
          <p className="muted">Yükleniyor…</p>
        ) : (
          <div className="hero-manager-body">
            {groups.map((group) => {
              const heroes = group.heroes.filter(matches);
              return (
                <section key={group.key} className="hero-group">
                  <h4>
                    {group.label}
                    <span className="muted micro"> {heroes.length}</span>
                  </h4>
                  {heroes.length ? (
                    <div className="hero-grid">
                      {heroes.map((hero) => (
                        <button
                          key={hero}
                          type="button"
                          className={
                            "hero-chip" + (edited.has(hero) ? " edited" : "")
                          }
                          title={heroDisplayName(hero)}
                          onClick={() => setSelected(hero)}
                        >
                          <HeroIcon hero={hero} size={40} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted micro">Aramaya uyan hero yok.</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {selected ? (
        <HeroDetailDialog
          record={catalog[selected]}
          edited={edited.has(selected)}
          onClose={() => setSelected("")}
          onSave={(patch) => save(selected, patch)}
        />
      ) : null}
    </div>
  );
}

/** Katalogdaki toplam hero sayisi (baslikta gosteriliyor). */
const HERO_COUNT = heroKeys().length;

/** Liste gorunumleri: Ozellik (ana ozellik) ya da Pozisyon (lane rolu). */
const VIEWS = [
  { key: "attribute", label: "Özellik" },
  { key: "lane", label: "Pozisyon" },
];

const DEFAULT_VIEW = "attribute";

/**
 * Ozellik / Pozisyon secici. Oyuncu Degerlendirme'deki donem seciciyle ayni
 * gorunumu kullanir.
 *
 * @param {{ value: string, onChange: (value: string) => void }} props
 */
function ViewSwitch({ value, onChange }) {
  return (
    <div className="period-switch" role="group" aria-label="Gruplama">
      {VIEWS.map((row) => (
        <button
          key={row.key}
          type="button"
          className={"period-btn" + (value === row.key ? " on" : "")}
          aria-pressed={value === row.key}
          onClick={() => onChange(row.key)}
        >
          {row.label}
        </button>
      ))}
    </div>
  );
}

/**
 * @param {string} a
 * @param {string} b
 */
const byDisplayName = (a, b) =>
  heroDisplayName(a).localeCompare(heroDisplayName(b), "tr");

/**
 * Hero'lari lane rolune gore gruplar.
 *
 * Bir hero birden fazla grupta gorunebilir (Pudge hem offlane hem sup5
 * oynaniyor); bu kasitli, cunku kullanici hero'yu oynadigi pozisyonda ariyor.
 * Hicbir rolu olmayan hero listeden DUSMEZ, "mid" grubuna alinir — gorunmeyen
 * bir hero duzenlenemez.
 *
 * @param {Record<string, Record<string, any>>} catalog
 * @returns {{ key: string, label: string, heroes: string[] }[]}
 */
function groupByLane(catalog) {
  /** @type {Record<string, string[]>} */
  const groups = Object.fromEntries(LANE_ROLES.map((role) => [role, []]));
  for (const [hero, record] of Object.entries(catalog)) {
    const roles = record.laneRoles?.length ? record.laneRoles : ["mid"];
    for (const role of roles) {
      if (groups[role]) {
        groups[role].push(hero);
      }
    }
  }
  return LANE_ROLES.map((role) => ({
    key: role,
    label: LANE_ROLE_LABELS[role],
    heroes: groups[role].sort(byDisplayName),
  }));
}

/**
 * Hero'lari ana ozellige gore gruplar (Strength / Agility / Intelligence / Universal).
 *
 * Her hero tam olarak bir grupta gorunur. Ana ozelligi bilinmeyen hero
 * listeden DUSMEZ, "Universal" grubuna alinir — gorunmeyen bir hero
 * duzenlenemez.
 *
 * @param {Record<string, Record<string, any>>} catalog
 * @returns {{ key: string, label: string, heroes: string[] }[]}
 */
function groupByAttribute(catalog) {
  /** @type {Record<string, string[]>} */
  const groups = Object.fromEntries(HERO_ATTRIBUTES.map((attr) => [attr, []]));
  for (const hero of Object.keys(catalog)) {
    const attr = heroPrimaryAttribute(hero);
    (groups[attr] || groups.all).push(hero);
  }
  return HERO_ATTRIBUTES.map((attr) => ({
    key: attr,
    label: HERO_ATTRIBUTE_LABELS[attr],
    heroes: groups[attr].sort(byDisplayName),
  }));
}

/**
 * Tek bir hero'nun duzenleme ekrani.
 *
 * Taslak YEREL tutulur ve yalnizca "Kaydet" ile sunucuya gider: her tus
 * vurusunda kaydetmek, canli mac panelini saniyede birkac kez tazeleyip
 * tavsiyeleri gozun onunde oynatirdi.
 *
 * @param {{
 *   record: Record<string, any>,
 *   edited: boolean,
 *   onClose: () => void,
 *   onSave: (patch: Record<string, any>|null) => Promise<void>
 * }} props
 */
function HeroDetailDialog({ record, edited, onClose, onSave }) {
  const [draft, setDraft] = useState(() => toDraft(record));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(toDraft(record));
    setError("");
  }, [record]);

  if (!record) {
    return null;
  }

  /**
   * Listeye ekler. Anahtar arama kutusundan GELDIGI icin ayrica cozumlenmez;
   * kullanicinin yazdigi serbest metin hicbir zaman kayda girmez.
   *
   * @param {string} field
   * @param {string} key
   */
  const addTo = (field, key) => {
    if (!key || draft[field].includes(key)) {
      return;
    }
    setDraft((current) => ({ ...current, [field]: [...current[field], key] }));
  };

  /**
   * @param {string} field
   * @param {string} key
   */
  const removeFrom = (field, key) =>
    setDraft((current) => ({
      ...current,
      [field]: current[field].filter((row) => row !== key),
    }));

  const commit = async (patch) => {
    setSaving(true);
    setError("");
    try {
      await onSave(patch);
      onClose();
    } catch (caught) {
      setError(caught?.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="hero-detail-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="hero-detail"
        role="dialog"
        aria-modal="true"
        aria-label={heroDisplayName(record.hero)}
      >
        <header className="hero-detail-head">
          <HeroIcon hero={record.hero} size={40} />
          <div>
            <strong>{heroDisplayName(record.hero) || record.hero}</strong>
            <span className="muted micro">
              {edited
                ? "düzenlenmiş (varsayılandan farklı)"
                : "varsayılan kayıt"}
            </span>
          </div>
          <button
            type="button"
            className="btn small hero-detail-close"
            onClick={onClose}
            aria-label="Kapat"
          >
            Kapat
          </button>
        </header>

        <section className="hero-detail-section">
          <h5>Pozisyonlar</h5>
          <div className="lane-row">
            {LANE_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                className={
                  "lane-chip" + (draft.laneRoles.includes(role) ? " on" : "")
                }
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    laneRoles: current.laneRoles.includes(role)
                      ? current.laneRoles.filter((row) => row !== role)
                      : [...current.laneRoles, role],
                  }))
                }
              >
                {LANE_ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </section>

        <section className="hero-detail-section">
          <h5>
            Özellikler
            <span className="muted micro">
              {" "}
              · rakip bu hero&apos;yu gördüğünde ne alsın
            </span>
          </h5>
          {/*
            Kutucuklar TEHDIT tablosunu besliyor: isaretli her ozellik, o hero
            karsi takimda gorundugunde bir item onerisi uretiyor (bkz.
            core/live/threats.js). Tohum listeler genel gecer — "Kez de
            gorunmez oluyor" demenin eskiden tek yolu depoyu duzenlemekti.
          */}
          <div className="trait-grid">
            {TRAIT_KEYS.map((key) => (
              <label
                key={key}
                className={
                  "trait-chip" + (draft.traits.includes(key) ? " on" : "")
                }
                // Tooltip "ne onerilir"i soyluyor: kutucugun adi tek basina
                // ("Kalkan / Bariyer") hangi itemi actigini anlatmiyor.
                title={TRAIT_TOOLTIPS[key]}
              >
                <input
                  type="checkbox"
                  checked={draft.traits.includes(key)}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      traits: current.traits.includes(key)
                        ? current.traits.filter((row) => row !== key)
                        : [...current.traits, key],
                    }))
                  }
                />
                <span>{TRAIT_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="hero-detail-section">
          <h5>
            Roller
            <span className="muted micro"> · takım radarını bu besliyor</span>
          </h5>
          <div className="role-grid">
            {ROLE_VALUE_KEYS.map((key) => (
              <RoleSlider
                key={key}
                label={ROLE_VALUE_LABELS[key]}
                value={draft.roleValues[key]}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    roleValues: { ...current.roleValues, [key]: value },
                  }))
                }
              />
            ))}
          </div>
        </section>

        <ListEditor
          title="Counter hero'lar"
          hint="Bu hero'yu zorlayan heroler"
          field="counterHeroes"
          values={draft.counterHeroes}
          kind="hero"
          onAdd={addTo}
          onRemove={removeFrom}
        />

        <ListEditor
          title="Counter itemler"
          hint="Bu hero'ya KARŞI alınan itemler — rakip takıma önerilir"
          field="counterItems"
          values={draft.counterItems}
          kind="item"
          onAdd={addTo}
          onRemove={removeFrom}
        />

        <ListEditor
          title="Gerekli itemler"
          hint="Hero'nun çekirdek planı; öneri listesinin başında gelir"
          field="requiredItems"
          values={draft.requiredItems}
          kind="item"
          onAdd={addTo}
          onRemove={removeFrom}
        />

        <ListEditor
          title="Durumsal itemler"
          hint="Plan dolmadığında tamamlayan itemler"
          field="situationalItems"
          values={draft.situationalItems}
          kind="item"
          onAdd={addTo}
          onRemove={removeFrom}
        />

        <ListEditor
          title="Hiç önerme"
          hint="Bu hero'da asla önerilmesin"
          field="removedItems"
          values={draft.removedItems}
          kind="item"
          onAdd={addTo}
          onRemove={removeFrom}
        />

        <footer className="hero-detail-foot">
          {error ? (
            <span className="chip bad" role="alert">
              {error}
            </span>
          ) : null}
          <button
            type="button"
            className="btn small"
            disabled={saving || !edited}
            // Bos govde hero'yu varsayilan kaydina dondurur.
            onClick={() => commit(null)}
            title="Bu hero'yu varsayılan kayda döndür"
          >
            Sıfırla
          </button>
          <button
            type="button"
            className="btn primary small"
            disabled={saving}
            onClick={() => commit(draft)}
          >
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Tek bir radar ekseni: kaydirici + sayi kutusu.
 *
 * Ikisi birden var cunku iki farkli is yapiliyor. Kaydirici "bu hero ne kadar
 * tasiyici" sorusunu goz karariyla ayarlamak icin — deger dolu bir cubuk olarak
 * gorunuyor ve sekiz eksen yan yana KARSILASTIRILABILIYOR. Sayi kutusu ise tam
 * bir deger yazmak icin; yalnizca kaydirici olsaydi 85'i tutturmak fare
 * hassasiyetine kalirdi.
 *
 * @param {{
 *   label: string,
 *   value: number,
 *   onChange: (value: number) => void
 * }} props
 */
function RoleSlider({ label, value, onChange }) {
  return (
    <label className="role-input">
      <span className="role-input-head">
        <span className="role-input-label">{label}</span>
        <input
          className="role-input-number"
          type="number"
          min="0"
          max="100"
          step="5"
          value={value}
          onChange={(event) => onChange(clamp(event.target.value))}
        />
      </span>
      <input
        className="role-input-range"
        type="range"
        min="0"
        max="100"
        step="5"
        value={value}
        // Dolu kismin genisligi CSS'e degiskenle gecirilir; `input[type=range]`
        // icin tarayicilar arasi tasinabilir baska bir yol yok.
        style={{ "--fill": value + "%" }}
        onChange={(event) => onChange(clamp(event.target.value))}
      />
    </label>
  );
}

/**
 * Ikonlu, silinebilir bir liste ve altinda arama kutusu.
 *
 * @param {{
 *   title: string,
 *   hint: string,
 *   field: string,
 *   values: string[],
 *   kind: "hero"|"item",
 *   onAdd: (field: string, key: string) => void,
 *   onRemove: (field: string, key: string) => void
 * }} props
 */
function ListEditor({ title, hint, field, values, kind, onAdd, onRemove }) {
  return (
    <section className="hero-detail-section">
      <h5>
        {title}
        <span className="muted micro"> · {hint}</span>
      </h5>

      <div className="chip-list">
        {values.length ? (
          values.map((key) => (
            <button
              key={key}
              type="button"
              className="entry-chip"
              title={
                (kind === "hero"
                  ? heroDisplayName(key)
                  : itemDisplayName(key)) + " — kaldırmak için tıkla"
              }
              onClick={() => onRemove(field, key)}
            >
              {kind === "hero" ? (
                <HeroIcon hero={key} size={28} />
              ) : (
                <img src={itemIconUrl(key)} alt="" loading="lazy" />
              )}
              <span className="micro">
                {kind === "hero" ? heroDisplayName(key) : itemDisplayName(key)}
              </span>
            </button>
          ))
        ) : (
          <span className="muted micro">Liste boş.</span>
        )}
      </div>

      <div className="add-row">
        <Combobox
          kind={kind}
          search={kind === "hero" ? searchHeroes : searchItems}
          placeholder={
            kind === "hero"
              ? "Hero ara (ör. sf, qop, pudge)"
              : "Item ara (ör. bkb, khanda, eul)"
          }
          exclude={values}
          onSelect={(key) => onAdd(field, key)}
        />
      </div>
    </section>
  );
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function clamp(value) {
  const number = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(100, number));
}

/**
 * Katalog kaydindan duzenlenebilir taslak.
 * @param {Record<string, any>|null} record
 */
function toDraft(record) {
  return {
    laneRoles: [...(record?.laneRoles || [])],
    traits: [...(record?.traits || [])],
    roleValues: Object.fromEntries(
      ROLE_VALUE_KEYS.map((key) => [
        key,
        Number(record?.roleValues?.[key] || 0),
      ]),
    ),
    counterHeroes: [...(record?.counterHeroes || [])],
    counterItems: [...(record?.counterItems || [])],
    requiredItems: [...(record?.requiredItems || [])],
    situationalItems: [...(record?.situationalItems || [])],
    removedItems: [...(record?.removedItems || [])],
  };
}
