import { useState, type CSSProperties } from "react";
import { THEME_HEADING, THEME_LEAD } from "../flow";
import { ThemeColourPicker } from "./ThemeColourPicker";
import { accentOption, readThemeAccent, type ThemeAccentOption } from "./theme";
import "./main-app.css";

export function ThemeOnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [paint, setPaint] = useState<ThemeAccentOption>(() => accentOption(readThemeAccent()));
  const style = {
    "--ma-accent": paint.hex,
    "--ma-accent-rgb": paint.rgb,
  } as CSSProperties;

  return (
    <section
      className="intro flow-screen theme-screen"
      aria-label="Theme colour"
      data-theme-accent={paint.value}
      style={style}
    >
      <div className="theme-stack">
        <h2 className="theme-heading">{THEME_HEADING}</h2>
        <p className="theme-lead">{THEME_LEAD}</p>
        <ThemeColourPicker accent={paint.value} onAccent={(next) => setPaint(accentOption(next))} />
        <div className="community-foot">
          <span className="community-foot-line" aria-hidden="true" />
          <button type="button" className="community-continue" onClick={onComplete}>
            Continue
          </button>
          <span className="community-foot-line" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
