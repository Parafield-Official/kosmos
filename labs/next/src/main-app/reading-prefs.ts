/**
 * Teleprompter look: reading font and page theme. Stored app-wide so Settings,
 * the booth, the reader, and chapter text share one choice.
 */

import type { PromptTheme, ReadingFont } from "./store";

const FONT_KEY = "kosmos-booth-font";
const THEME_KEY = "kosmos-booth-theme";
const BOOTH_SIZE_KEY = "kosmos-booth-font-px";

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

export const PROMPT_THEME_VALUES = [
  "white",
  "black",
  "glass",
  "smoke",
  "cream",
  "ivory",
  "sepia",
  "newsprint",
  "laid",
  "kraft",
] as const satisfies readonly PromptTheme[];

export const PROMPT_THEME_GROUPS: ReadonlyArray<{
  label: string;
  options: ReadonlyArray<{ value: PromptTheme; label: string }>;
}> = [
  {
    label: "Digital",
    options: [
      { value: "white", label: "White" },
      { value: "black", label: "Black" },
      { value: "glass", label: "Glass" },
      { value: "smoke", label: "Smoke" },
    ],
  },
  {
    label: "Paper",
    options: [
      { value: "cream", label: "Cream" },
      { value: "ivory", label: "Ivory" },
      { value: "sepia", label: "Sepia" },
      { value: "newsprint", label: "Newsprint" },
      { value: "laid", label: "Laid" },
      { value: "kraft", label: "Kraft" },
    ],
  },
];

export const PROMPT_THEME_OPTIONS = PROMPT_THEME_GROUPS.flatMap((group) => group.options);

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
  const stored = readStored(THEME_KEY, [...PROMPT_THEME_VALUES, "dark"] as const, "black");
  return stored === "dark" ? "black" : stored;
}

export function writePromptTheme(theme: PromptTheme): void {
  writeStored(THEME_KEY, theme);
}

export const BOOTH_FONT_RANGE = { min: 20, max: 48, fallback: 28 } as const;

export function readBoothFontPx(): number {
  try {
    const raw = Number(window.localStorage.getItem(BOOTH_SIZE_KEY));
    if (Number.isFinite(raw)) {
      return Math.min(BOOTH_FONT_RANGE.max, Math.max(BOOTH_FONT_RANGE.min, Math.round(raw)));
    }
  } catch {
    // Fall through.
  }
  return BOOTH_FONT_RANGE.fallback;
}

export function writeBoothFontPx(size: number): number {
  const next = Math.min(BOOTH_FONT_RANGE.max, Math.max(BOOTH_FONT_RANGE.min, Math.round(size)));
  try {
    window.localStorage.setItem(BOOTH_SIZE_KEY, String(next));
  } catch {
    // Best effort.
  }
  return next;
}
