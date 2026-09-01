import { useEffect, useId, useMemo, useState } from "react";
import {
  PIGMENT_BOUNDS,
  THEME_ACCENT_OPTIONS,
  accentOption,
  applyThemeAccent,
  hslFromHex,
  pigmentHexFromHsl,
  readCustomHex,
  type ThemeAccent,
} from "./theme";

type ThemeColourPickerProps = {
  accent: ThemeAccent;
  onAccent: (accent: ThemeAccent) => void;
};

export function ThemeColourPicker({ accent, onAccent }: ThemeColourPickerProps) {
  const hueId = useId();
  const depthId = useId();
  const richnessId = useId();
  const [mixOpen, setMixOpen] = useState(false);
  const selected = accentOption(accent);
  const startHex = accent === "custom" ? readCustomHex() : selected.hex;
  const [hsl, setHsl] = useState(() => hslFromHex(startHex));

  useEffect(() => {
    if (accent !== "custom") {
      return;
    }
    setHsl(hslFromHex(readCustomHex()));
  }, [accent]);

  function choosePreset(next: ThemeAccent) {
    setMixOpen(false);
    onAccent(applyThemeAccent(next));
  }

  function openMixer() {
    if (mixOpen && accent === "custom") {
      setMixOpen(false);
      return;
    }
    const current = accent === "custom" ? readCustomHex() : accentOption(accent).hex;
    const nextHsl = hslFromHex(current);
    setHsl(nextHsl);
    setMixOpen(true);
    onAccent(applyThemeAccent("custom", pigmentHexFromHsl(nextHsl.h, nextHsl.s, nextHsl.l)));
  }

  function mix(next: { h?: number; s?: number; l?: number }) {
    const pigment = {
      h: next.h ?? hsl.h,
      s: next.s ?? hsl.s,
      l: next.l ?? hsl.l,
    };
    setHsl(pigment);
    setMixOpen(true);
    onAccent(applyThemeAccent("custom", pigmentHexFromHsl(pigment.h, pigment.s, pigment.l)));
  }

  const mixedHex = useMemo(() => pigmentHexFromHsl(hsl.h, hsl.s, hsl.l), [hsl]);
  const depth = Math.round(
    ((PIGMENT_BOUNDS.lightMax - hsl.l) / (PIGMENT_BOUNDS.lightMax - PIGMENT_BOUNDS.lightMin)) * 100,
  );
  const richness = Math.round(
    ((hsl.s - PIGMENT_BOUNDS.satMin) / (PIGMENT_BOUNDS.satMax - PIGMENT_BOUNDS.satMin)) * 100,
  );

  return (
    <div className="ma-pigment">
      <div className="ma-pigment-tray" role="radiogroup" aria-label="Theme colour">
        {THEME_ACCENT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-label={option.label}
            aria-checked={accent === option.value}
            className={accent === option.value ? "ma-pigment-dot is-on" : "ma-pigment-dot"}
            style={{ backgroundColor: option.hex }}
            onClick={() => choosePreset(option.value)}
          />
        ))}
        <button
          type="button"
          role="radio"
          aria-label="Mix a custom pigment"
          aria-checked={accent === "custom"}
          aria-expanded={mixOpen}
          className={accent === "custom" ? "ma-pigment-mix is-on" : "ma-pigment-mix"}
          onClick={openMixer}
        >
          <span className="ma-pigment-mix-core" style={{ backgroundColor: mixedHex }} />
        </button>
      </div>

      <p className="ma-pigment-caption">
        <strong>{selected.label}</strong>
        {accent === "custom" ? <span>{mixedHex}</span> : null}
      </p>

      {mixOpen ? (
        <div className="ma-pigment-mixer" role="group" aria-label="Mix a pigment">
          <label className="ma-pigment-field" htmlFor={hueId}>
            <span>Hue</span>
            <input
              id={hueId}
              className="ma-pigment-hue"
              type="range"
              min={0}
              max={360}
              step={1}
              value={Math.round(hsl.h)}
              aria-valuetext={`${Math.round(hsl.h)} degrees`}
              onChange={(event) => mix({ h: Number(event.target.value) })}
            />
          </label>
          <label className="ma-pigment-field" htmlFor={depthId}>
            <span>Depth</span>
            <input
              id={depthId}
              type="range"
              min={0}
              max={100}
              step={1}
              value={depth}
              aria-valuetext={`${depth} percent`}
              onChange={(event) => {
                const t = Number(event.target.value) / 100;
                mix({ l: PIGMENT_BOUNDS.lightMax - t * (PIGMENT_BOUNDS.lightMax - PIGMENT_BOUNDS.lightMin) });
              }}
            />
          </label>
          <label className="ma-pigment-field" htmlFor={richnessId}>
            <span>Richness</span>
            <input
              id={richnessId}
              type="range"
              min={0}
              max={100}
              step={1}
              value={richness}
              aria-valuetext={`${richness} percent`}
              onChange={(event) => {
                const t = Number(event.target.value) / 100;
                mix({ s: PIGMENT_BOUNDS.satMin + t * (PIGMENT_BOUNDS.satMax - PIGMENT_BOUNDS.satMin) });
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
