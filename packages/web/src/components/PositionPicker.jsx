import "./PositionPicker.css";

/** Pozisyon dugmeleri: kisa ad ve rol. */
const POSITIONS = [
  { key: "pos1", short: "Pos 1", role: "Carry" },
  { key: "pos2", short: "Pos 2", role: "Mid" },
  { key: "pos3", short: "Pos 3", role: "Offlane" },
  { key: "pos4", short: "Pos 4", role: "Soft Support" },
  { key: "pos5", short: "Pos 5", role: "Hard Support" },
];

/**
 * Kullanicinin bu mactaki pozisyonu.
 *
 * Oyundan once secilir, mac sirasinda ya da sonrasinda degistirilebilir.
 * Draft asistani kullaniciyi bu pozisyona yerlestirir; item tavsiyesi core /
 * destek ayrimini buna gore yapar. Secili pozisyona yeniden basmak secimi
 * kaldirir.
 *
 * @param {{ value: string, onChange: (role: string) => void, disabled?: boolean }} props
 */
export function PositionPicker({ value, onChange, disabled = false }) {
  return (
    <section className="position-picker" aria-label="Pozisyonun">
      <div className="position-picker-head">
        <strong>Pozisyonun</strong>
        <span className="muted micro">
          {value
            ? "Draft ve item önerileri bu pozisyona göre hazırlanıyor."
            : "Seçersen draft ve item önerileri pozisyonuna göre hazırlanır."}
        </span>
      </div>
      <div className="position-buttons" role="group">
        {POSITIONS.map((row) => {
          const active = value === row.key;
          return (
            <button
              key={row.key}
              type="button"
              className={"position-button" + (active ? " active" : "")}
              aria-pressed={active}
              disabled={disabled}
              title={
                active ? "Seçimi kaldırmak için tekrar bas" : row.short + " seç"
              }
              onClick={() => onChange(row.key)}
            >
              <strong>{row.short}</strong>
              <span>{row.role}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
