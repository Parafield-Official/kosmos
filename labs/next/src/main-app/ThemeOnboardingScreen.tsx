import { useState } from "react";
import { THEME_HEADING, THEME_LEAD } from "../flow";
import { ThemeColourPicker } from "./ThemeColourPicker";
import { accentOption, readThemeAccent, type ThemeAccentOption } from "./theme";
import "./main-app.css";

export function PigmentOnboardingPanel({ onComplete }: { onComplete: () => void }) {
  const [paint, setPaint] = useState<ThemeAccentOption>(() => accentOption(readThemeAccent()));

  return (
    <section className="ma-screen ma-settings ma-theme-onboard" aria-label="Colour">
      <div className="ma-theme-onboard-stack">
        <header className="ma-theme-onboard-head">
          <h1 className="ma-title">{THEME_HEADING}</h1>
          <p className="ma-theme-onboard-copy">{THEME_LEAD}</p>
        </header>
        <ThemeColourPicker
          accent={paint.value}
          onAccent={(next) => setPaint(accentOption(next))}
        />
        <button type="button" className="theme-continue" onClick={onComplete}>
          Continue
        </button>
      </div>
    </section>
  );
}
