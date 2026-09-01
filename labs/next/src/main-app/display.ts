// Global display preferences that apply across the whole Labs app (not just the
// booth). Stored per-viewer in localStorage and applied to the document root, so
// rem-based styles scale together.

const FONT_SCALE_KEY = "kosmos-labs-font-scale";

export type FontScale = 0.9 | 1 | 1.1 | 1.25;

const SCALES: readonly FontScale[] = [0.9, 1, 1.1, 1.25];

export const FONT_SCALE_OPTIONS: ReadonlyArray<{ value: FontScale; label: string }> = [
  { value: 0.9, label: "Small" },
  { value: 1, label: "Default" },
  { value: 1.1, label: "Large" },
  { value: 1.25, label: "Larger" },
];

const BASE_FONT_PX = 16;

export function readFontScale(): FontScale {
  try {
    const raw = Number(window.localStorage.getItem(FONT_SCALE_KEY));
    if ((SCALES as readonly number[]).includes(raw)) {
      return raw as FontScale;
    }
  } catch {
    // Private windows or blocked storage: fall back to the default.
  }
  return 1;
}

export function applyFontScale(scale: FontScale): void {
  const root = document.documentElement;
  root.style.setProperty("--font-scale", String(scale));
  root.style.fontSize = `${Math.round(BASE_FONT_PX * scale)}px`;
}

export function writeFontScale(scale: FontScale): void {
  try {
    window.localStorage.setItem(FONT_SCALE_KEY, String(scale));
  } catch {
    // Best effort; still apply for this session.
  }
  applyFontScale(scale);
}
