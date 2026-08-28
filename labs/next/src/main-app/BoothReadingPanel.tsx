import { LIVE_HALT_RUN_WORDS } from "../../../../src/core/teleprompter/live";
import type { PromptHighlightMode } from "./store";

export function BoothReadingPanel({
  inputs,
  inputId,
  recording,
  highlight,
  lineSpacing,
  checkReading,
  stopOnMismatch,
  onInput,
  onHighlight,
  onSpacing,
  onCheckReading,
  onStopOnMismatch,
  theme,
  onTheme,
  fontPx,
  onFontPx,
}: {
  inputs: MediaDeviceInfo[];
  inputId: string;
  recording: boolean;
  highlight: PromptHighlightMode;
  lineSpacing: number;
  checkReading: boolean;
  stopOnMismatch: boolean;
  onInput: (deviceId: string) => void;
  onHighlight: (mode: PromptHighlightMode) => void;
  onSpacing: (value: number) => void;
  onCheckReading: (enabled: boolean) => void;
  onStopOnMismatch: (enabled: boolean) => void;
  theme: import("./store").PromptTheme;
  onTheme: (theme: import("./store").PromptTheme) => void;
  fontPx: number;
  onFontPx: (size: number) => void;
}) {
  return (
    <div className="ma-booth-settings" role="dialog" aria-label="Reading settings">
      <p className="ma-booth-kicker">Microphone</p>
      <label className="ma-booth-input">
        <span>Recording input</span>
        <select value={inputId} disabled={recording} onChange={(event) => onInput(event.target.value)}>
          <option value="">System default</option>
          {inputs.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </option>
          ))}
        </select>
        <em>Raw mono capture. Change inputs between reads.</em>
      </label>

      <p className="ma-booth-kicker">Highlight as you read</p>
      <div className="ma-booth-choices" role="radiogroup" aria-label="Highlight as you read">
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
      <p className="ma-booth-hint">
        {highlight === "word"
          ? "Marks the single word you are on."
          : highlight === "line"
            ? "Lights the line you are on. Easier to follow, and it never moves ahead of you."
            : "Lights the whole paragraph you are on. Steadiest, with the least movement."}
      </p>

      <p className="ma-booth-kicker">Line spacing</p>
      <div className="ma-booth-choices" role="radiogroup" aria-label="Line spacing">
        {[
          [1.35, "Tight"],
          [1.55, "Comfortable"],
          [1.8, "Spacious"],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={lineSpacing === value}
            className={lineSpacing === value ? "is-on" : undefined}
            onClick={() => onSpacing(Number(value))}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="ma-booth-kicker">Page texture</p>
      <div className="ma-booth-choices" role="radiogroup" aria-label="Page texture">
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

      <p className="ma-booth-kicker">Teleprompter size</p>
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

      <label className="ma-booth-toggle">
        <span>
          <strong>Check my reading</strong>
          <em>Marks words that may not match the script so you can review them later.</em>
        </span>
        <input
          type="checkbox"
          checked={checkReading}
          onChange={(event) => onCheckReading(event.target.checked)}
        />
      </label>

      <label className="ma-booth-toggle">
        <span>
          <strong>Pause if I lose my place</strong>
          <em>Freezes the page after {LIVE_HALT_RUN_WORDS} words do not match. Recording keeps going.</em>
        </span>
        <input
          type="checkbox"
          checked={stopOnMismatch}
          onChange={(event) => onStopOnMismatch(event.target.checked)}
        />
      </label>

      <div className="ma-booth-keys" aria-label="Keyboard and foot pedal shortcuts">
        <strong>Keyboard or programmable pedal</strong>
        <span>
          <kbd>F7</kbd> Continue
        </span>
        <span>
          <kbd>F8</kbd> Restart sentence
        </span>
        <span>
          <kbd>F9</kbd> Mark for Review
        </span>
        <span>
          <kbd>F10</kbd> Pause or resume
        </span>
      </div>
    </div>
  );
}
