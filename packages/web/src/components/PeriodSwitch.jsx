import { PERIODS } from "@dotastat/core";
import "./PeriodSwitch.css";

/**
 * Hafta / Ay / Son 60 secici.
 *
 * Dugmeler, acilir liste degil: secenek sayisi az ve hepsi tek tikla
 * erisilebilir olmali — hangisinde oldugun da bakmadan gorunmeli.
 *
 * @param {{ value: string, onChange: (value: string) => void }} props
 */
export function PeriodSwitch({ value, onChange }) {
  return (
    <div className="period-switch" role="group" aria-label="Dönem">
      {Object.values(PERIODS).map((row) => (
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
