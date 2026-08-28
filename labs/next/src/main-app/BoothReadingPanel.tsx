import type { PromptHighlightMode, PromptTheme } from "./store";

/** Spec knobs only: current indicator, line spacing, texture, font size. */
export function BoothReadingPanel({
  highlight,
  lineSpacing,
  onHighlight,
  onSpacing,
  theme,
  onTheme,
  fontPx,
  onFontPx,
}: {
  highlight: PromptHighlightMode;
  lineSpacing: number;
  onHighlight: (mode: PromptHighlightMode) => void;
  onSpacing: (value: number) => void;
  theme: PromptTheme;
  onTheme: (theme: PromptTheme) => void;
  fontPx: number;
  onFontPx: (size: number) => void;
}) {
  return (
    <div className="ma-booth-settings" role="region" aria-label="Teleprompter setting">
      <div className="ma-booth-set">
        <p className="ma-booth-kicker">Current indicator</p>
        <div className="ma-booth-choices" role="radiogroup" aria-label="Current indicator">
          {(["word", "line", "paragraph"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={highlight === value}
              className={highlight === value ? "is-on" : undefined}
              onClick={() => onHighlight(value)}
            >
              {value === "word" ? "Word" : value === "line" ? "Line" : "Paragraph"}
            </button>
          ))}
        </div>
      </div>

      <div className="ma-booth-set">
        <p className="ma-booth-kicker">Line spacing</p>
        <div className="ma-booth-choices" role="radiogroup" aria-label="Line spacing">
          {(
            [
              [1.35, "Tight"],
              [1.55, "Comfortable"],
              [1.8, "Spacious"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={lineSpacing === value}
              className={lineSpacing === value ? "is-on" : undefined}
              onClick={() => onSpacing(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ma-booth-set">
        <p className="ma-booth-kicker">Teleprompter texture</p>
        <div className="ma-booth-choices" role="radiogroup" aria-label="Teleprompter texture">
          {(["dark", "sepia", "cream"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              className={theme === value ? "is-on" : undefined}
              onClick={() => onTheme(value)}
            >
              {value === "dark" ? "Dark" : value === "sepia" ? "Sepia" : "Cream"}
            </button>
          ))}
        </div>
      </div>

      <div className="ma-booth-set">
        <p className="ma-booth-kicker">Teleprompter font size</p>
        <label className="ma-set-slider">
          <input
            type="range"
            min={20}
            max={48}
            step={1}
            value={fontPx}
            aria-label="Teleprompter font size"
            onChange={(event) => onFontPx(Number(event.target.value))}
          />
          <span className="ma-set-slider-value">{fontPx} px</span>
        </label>
      </div>
    </div>
  );
}
