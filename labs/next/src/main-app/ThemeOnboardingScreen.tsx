import { useState } from "react";
import { THEME_HEADING, THEME_LEAD } from "../flow";
import { ThemeColourPicker } from "./ThemeColourPicker";
import { accentOption, readThemeAccent, type ThemeAccentOption } from "./theme";
import "./main-app.css";

export function PigmentOnboardingPanel({ onComplete }: { onComplete: () => void }) {
  const [paint, setPaint] = useState<ThemeAccentOption>(() => accentOption(readThemeAccent()));

  return (
    <section className="ma-screen ma-settings ma-theme-onboard" aria-label="Theme colour">
      <header className="ma-set-masthead">
        <span className="ma-set-masthead-space" aria-hidden="true" />
        <h1 className="ma-title">{THEME_HEADING}</h1>
        <span className="ma-set-masthead-space" aria-hidden="true" />
      </header>
      <p className="ma-theme-onboard-copy">{THEME_LEAD}</p>
      <div className="ma-set-columns">
        <div className="ma-set-col">
          <p className="ma-set-kicker">Display</p>
          <div className="ma-set-card">
            <div className="ma-set-item">
              <div className="ma-set-copy">
                <div className="ma-set-head">
                  <AccentIcon />
                  <strong>Theme colour</strong>
                </div>
              </div>
              <ThemeColourPicker
                accent={paint.value}
                onAccent={(next) => setPaint(accentOption(next))}
              />
            </div>
          </div>
        </div>
      </div>
      <button type="button" className="theme-continue" onClick={onComplete}>
        Continue
      </button>
    </section>
  );
}

function AccentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M4 15.5c2.5-7 6.2-10.5 11-10.5 3.3 0 5 1.8 5 4.3 0 4.8-5 9.7-11.2 9.7C5.8 19 3.2 18 4 15.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="15.8" cy="9.1" r="2.1" fill="currentColor" />
    </svg>
  );
}
