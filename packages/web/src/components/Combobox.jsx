import { useEffect, useId, useMemo, useRef, useState } from "react";
import { itemIconUrl } from "@dotastat/core";
import { HeroIcon } from "./primitives.jsx";
import "./Combobox.css";

/**
 * Yazarken arayan, ikonlu bir secim kutusu.
 *
 * NEDEN VAR: hero ve item eklerken TAM ic anahtari yazmak gerekiyordu
 * (`black_king_bar`, `keeper_of_the_light`). Kimse bunlari ezbere bilmiyor ve
 * bir harf hatasi kaydi sessizce dusuruyordu. Artik birkac harf yeter, aday
 * listesi altta acilir ve tiklayarak ya da Enter ile secilir — oyundaki dukkan
 * aramasi gibi. Kisaltmalar da calisir ("bkb", "qop").
 *
 * KLAVYE: ok tuslariyla gezilir, Enter secer, Esc kapatir. Fare gerekmemeli;
 * bir hero'nun listesini doldururken elin klavyeden kalkmasi isi yavaslatiyor.
 *
 * Eslestirme ARAYUZDE DEGIL cekirdekte (bkz. core/heroes/search.js): takma ad
 * ve gorunen ad bilgisi motorun kullandigi bilginin aynisi olmali.
 *
 * @param {Object} props
 * @param {(query: string) => Array<{ key: string, name: string }>} props.search
 * @param {(key: string) => void} props.onSelect Secilen anahtar
 * @param {"hero"|"item"} props.kind Ikon turu
 * @param {string} [props.placeholder]
 * @param {string[]} [props.exclude] Listede gosterilmeyecek anahtarlar
 * @param {boolean} [props.disabled]
 */
export function Combobox({
  search,
  onSelect,
  kind,
  placeholder = "Ara…",
  exclude = [],
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listId = useId();

  // Zaten listede olanlar aday olarak gosterilmez: ayni itemi ikinci kez
  // eklemek bir sey yapmiyor ve kullaniciyi "ekledim ama olmadi"ya dusuruyor.
  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const rows = useMemo(
    () => search(query).filter((row) => !excluded.has(row.key)),
    [search, query, excluded],
  );

  // Sorgu degistiginde secim bastan baslar; yoksa liste kisaldiginda imlec
  // gorunmeyen bir satirda kaliyor.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Disari tiklaninca kapanir.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /** @param {{ key: string }} row */
  const choose = (row) => {
    if (!row) {
      return;
    }
    onSelect(row.key);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => {
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        if (!rows.length) {
          return 0;
        }
        return (next + rows.length) % rows.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[active]);
    }
  };

  return (
    <div className="combobox" ref={boxRef}>
      <div className="combobox-field">
        <span className="combobox-icon" aria-hidden="true">
          🔎
        </span>
        <input
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && !disabled ? (
        <ul className="combobox-list" id={listId} role="listbox">
          {rows.length ? (
            rows.map((row, index) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={
                    "combobox-option" + (index === active ? " active" : "")
                  }
                  // `onMouseDown`, `onClick` degil: tiklamada input once blur
                  // olup listeyi kapatiyor ve tiklama bosa gidiyordu.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(row);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  {kind === "hero" ? (
                    <HeroIcon hero={row.key} size={28} />
                  ) : (
                    <img
                      className="combobox-item-icon"
                      src={itemIconUrl(row.key)}
                      alt=""
                      loading="lazy"
                    />
                  )}
                  <span className="combobox-name">{row.name}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="combobox-empty muted micro">Eşleşen kayıt yok.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
