/**
 * Teleprompter look: reading font and page theme. Stored app-wide so Settings
 * and the booth share one choice. Highlight, spacing, and live QC stay in the
 * booth panel.
 */

import type { PromptTheme, ReadingFont } from "./store";

const FONT_KEY = "kosmos-booth-font";
const THEME_KEY = "kosmos-booth-theme";

export const READING_FONT_OPTIONS: ReadonlyArray<{ value: ReadingFont; label: string }> = [
  { value: "serif", label: "Book serif" },
  { value: "sans", label: "Clean sans" },
  { value: "hyperlegible", label: "Hyperlegible" },
];

export const PROMPT_THEME_OPTIONS: ReadonlyArray<{ value: PromptTheme; label: string }> = [
  { value: "cream", label: "Cream" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
];

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
  } catch {
    // Private windows or blocked storage: fall back to the default.
  }
  return fallback;
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort; the in-memory choice still applies for this session.
  }
}

export function readReadingFont(): ReadingFont {
  return readStored(FONT_KEY, ["serif", "sans", "hyperlegible"] as const, "serif");
}

export function writeReadingFont(font: ReadingFont): void {
  writeStored(FONT_KEY, font);
}

export function readPromptTheme(): PromptTheme {
  return readStored(THEME_KEY, ["dark", "sepia", "cream"] as const, "dark");
}

export function writePromptTheme(theme: PromptTheme): void {
  writeStored(THEME_KEY, theme);
}
