/**
 * Teleprompter look: reading font and page theme. Stored app-wide so Settings,
 * the booth, the reader, and chapter text share one choice.
 */

import type { PromptTheme, ReadingFont } from "./store";

const FONT_KEY = "kosmos-booth-font";
const THEME_KEY = "kosmos-booth-theme";

export const READING_FONT_VALUES = [
  "serif",
  "sans",
  "palatino",
  "courier",
  "clear",
  "hyperlegible",
] as const satisfies readonly ReadingFont[];

/** Stacks that ship on Mac and Windows without bundling files. */
export const READING_FONT_STACKS: Record<ReadingFont, string> = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", sans-serif',
  palatino: 'Palatino, "Palatino Linotype", "Book Antiqua", "Iowan Old Style", serif',
  courier: '"Courier New", Courier, ui-monospace, Menlo, monospace',
  clear: 'Verdana, Tahoma, "Trebuchet MS", sans-serif',
  hyperlegible: '"Atkinson Hyperlegible", Verdana, Arial, sans-serif',
};

export const READING_FONT_OPTIONS: ReadonlyArray<{ value: ReadingFont; label: string }> = [
  { value: "serif", label: "Georgia" },
  { value: "sans", label: "Helvetica" },
  { value: "palatino", label: "Palatino" },
  { value: "courier", label: "Courier" },
  { value: "clear", label: "Verdana" },
  { value: "hyperlegible", label: "Atkinson" },
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
  return readStored(FONT_KEY, READING_FONT_VALUES, "serif");
}

export function applyReadingFont(font: ReadingFont): void {
  document.documentElement.dataset.readingFont = font;
}

export function writeReadingFont(font: ReadingFont): void {
  writeStored(FONT_KEY, font);
  applyReadingFont(font);
}

export function readPromptTheme(): PromptTheme {
  return readStored(THEME_KEY, ["dark", "sepia", "cream"] as const, "dark");
}

export function writePromptTheme(theme: PromptTheme): void {
  writeStored(THEME_KEY, theme);
}
