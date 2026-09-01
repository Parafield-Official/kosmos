import type { PromptHighlightMode, PromptTheme } from "./store";
import { PROMPT_THEME_GROUPS } from "./reading-prefs";

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
        <div className="ma-booth-paper">
          {PROMPT_THEME_GROUPS.map((group) => (
            <div className="ma-booth-paper-group" key={group.label}>
              <p className="ma-booth-paper-label">{group.label}</p>
              <div className="ma-booth-themes" role="radiogroup" aria-label={group.label}>
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={theme === option.value || (option.value === "black" && theme === "dark")}
                    className={`ma-booth-theme is-${option.value}${
                      theme === option.value || (option.value === "black" && theme === "dark") ? " is-on" : ""
                    }`}
                    onClick={() => onTheme(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
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
