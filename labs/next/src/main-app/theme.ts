export type ThemePreset =
  | "graphite"
  | "slate"
  | "cobalt"
  | "ink"
  | "plum"
  | "wine"
  | "oxblood"
  | "umber"
  | "moss"
  | "pine";

export type ThemeAccent = ThemePreset | "custom";

export type ThemeAccentOption = {
  value: ThemeAccent;
  label: string;
  hex: string;
  rgb: string;
};

export type PigmentHsl = {
  h: number;
  s: number;
  l: number;
};

/** Atmosphere-safe pigment: dark and muted so the white canvas stays the page. */
export const PIGMENT_BOUNDS = {
  satMin: 0.04,
  satMax: 0.6,
  lightMin: 0.09,
  lightMax: 0.28,
} as const;

export const THEME_ACCENT_OPTIONS: ReadonlyArray<ThemeAccentOption> = [
  { value: "graphite", label: "Graphite", hex: "#1b1c1e", rgb: "27, 28, 30" },
  { value: "slate", label: "Slate", hex: "#2c3842", rgb: "44, 56, 66" },
  { value: "cobalt", label: "Cobalt", hex: "#193b63", rgb: "25, 59, 99" },
  { value: "ink", label: "Ink", hex: "#221c3d", rgb: "34, 28, 61" },
  { value: "plum", label: "Plum", hex: "#50384c", rgb: "80, 56, 76" },
  { value: "wine", label: "Wine", hex: "#542436", rgb: "84, 36, 54" },
  { value: "oxblood", label: "Oxblood", hex: "#651f26", rgb: "101, 31, 38" },
  { value: "umber", label: "Umber", hex: "#4a3224", rgb: "74, 50, 36" },
  { value: "moss", label: "Moss", hex: "#293b32", rgb: "41, 59, 50" },
  { value: "pine", label: "Pine", hex: "#1a3530", rgb: "26, 53, 48" },
];

export const DEFAULT_THEME_ACCENT: ThemeAccent = "plum";
export const DEFAULT_CUSTOM_HEX = "#50384c";

const ACCENT_KEY = "kosmos-labs-theme-accent";
const CUSTOM_KEY = "kosmos-labs-theme-custom";
const ATMOSPHERE_SEED_KEY = "kosmos-labs-atmosphere-seed";
export const THEME_ACCENT_EVENT = "kosmos-theme-accent-changed";

const PRESET_IDS = new Set<string>(THEME_ACCENT_OPTIONS.map((option) => option.value));

function canStore() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): PigmentHsl {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === nr) {
    h = (ng - nb) / d + (ng < nb ? 6 : 0);
  } else if (max === ng) {
    h = (nb - nr) / d + 2;
  } else {
    h = (nr - ng) / d + 4;
  }
  return { h: h * 60, s, l };
}

function hueToRgb(p: number, q: number, t: number) {
  let tone = t;
  if (tone < 0) tone += 1;
  if (tone > 1) tone -= 1;
  if (tone < 1 / 6) return p + (q - p) * 6 * tone;
  if (tone < 1 / 2) return q;
  if (tone < 2 / 3) return p + (q - p) * (2 / 3 - tone) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.min(1, Math.max(0, s));
  const lit = Math.min(1, Math.max(0, l));
  if (sat === 0) {
    const value = Math.round(lit * 255);
    return { r: value, g: value, b: value };
  }
  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
  const p = 2 * lit - q;
  return {
    r: Math.round(hueToRgb(p, q, hue + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hue) * 255),
    b: Math.round(hueToRgb(p, q, hue - 1 / 3) * 255),
  };
}

export function clampPigmentHex(hex: string): string {
  const rgb = parseHexColor(hex);
  if (!rgb) {
    return DEFAULT_CUSTOM_HEX;
  }
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return pigmentHexFromHsl(hsl.h, hsl.s, hsl.l);
}

export function pigmentHexFromHsl(h: number, s: number, l: number): string {
  const rgb = hslToRgb(
    h,
    Math.min(PIGMENT_BOUNDS.satMax, Math.max(PIGMENT_BOUNDS.satMin, s)),
    Math.min(PIGMENT_BOUNDS.lightMax, Math.max(PIGMENT_BOUNDS.lightMin, l)),
  );
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function hexToRgbString(hex: string): string {
  const rgb = parseHexColor(hex) ?? parseHexColor(DEFAULT_CUSTOM_HEX)!;
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

export function hslFromHex(hex: string): PigmentHsl {
  const rgb = parseHexColor(hex) ?? parseHexColor(DEFAULT_CUSTOM_HEX)!;
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

function isThemeAccent(value: string | null): value is ThemeAccent {
  return value === "custom" || (value !== null && PRESET_IDS.has(value));
}

export function readThemeAccent(): ThemeAccent {
  if (!canStore()) {
    return DEFAULT_THEME_ACCENT;
  }
  const stored = window.localStorage.getItem(ACCENT_KEY);
  return isThemeAccent(stored) ? stored : DEFAULT_THEME_ACCENT;
}

export function readCustomHex(): string {
  if (!canStore()) {
    return DEFAULT_CUSTOM_HEX;
  }
  const stored = window.localStorage.getItem(CUSTOM_KEY);
  return stored ? clampPigmentHex(stored) : DEFAULT_CUSTOM_HEX;
}

export function writeCustomHex(hex: string): string {
  const clamped = clampPigmentHex(hex);
  if (canStore()) {
    window.localStorage.setItem(CUSTOM_KEY, clamped);
  }
  return clamped;
}

export function writeThemeAccent(accent: ThemeAccent): ThemeAccent {
  if (canStore()) {
    window.localStorage.setItem(ACCENT_KEY, accent);
    window.dispatchEvent(new CustomEvent<ThemeAccentOption>(THEME_ACCENT_EVENT, { detail: accentOption(accent) }));
  }
  return accent;
}

export function applyThemeAccent(accent: ThemeAccent, customHex?: string): ThemeAccent {
  if (accent === "custom") {
    writeCustomHex(customHex ?? readCustomHex());
  }
  return writeThemeAccent(accent);
}

export function accentOption(accent: ThemeAccent): ThemeAccentOption {
  if (accent === "custom") {
    const hex = readCustomHex();
    return { value: "custom", label: "Mixed", hex, rgb: hexToRgbString(hex) };
  }
  return THEME_ACCENT_OPTIONS.find((option) => option.value === accent) ?? THEME_ACCENT_OPTIONS[4];
}

export function readAtmosphereSeed(): number {
  if (!canStore()) {
    return 1729;
  }
  const stored = Number(window.localStorage.getItem(ATMOSPHERE_SEED_KEY));
  if (Number.isFinite(stored) && stored > 0) {
    return stored;
  }
  const seed = typeof crypto !== "undefined" && "getRandomValues" in crypto
    ? crypto.getRandomValues(new Uint32Array(1))[0] || 1729
    : Math.floor(Math.random() * 0xffffffff) || 1729;
  window.localStorage.setItem(ATMOSPHERE_SEED_KEY, String(seed));
  return seed;
}

/** Deterministic 0–1 stream. Same seed always paints the same weather. */
export function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export type AtmosphereCloud = {
  x: number;
  y: number;
  w: number;
  h: number;
  o: number;
  r: number;
  drift: number;
};

/** Soft pigment blobs. Intensity drives size and opacity together, like a mesh. */
export function atmosphereClouds(seed: number, count = 7, gain = 1): AtmosphereCloud[] {
  const random = mulberry32(seed);
  const amp = Math.min(2.6, Math.max(0.5, gain));
  return Array.from({ length: count }, (_, index) => {
    const intensity = random();
    return {
      x: -12 + random() * 112,
      y: -22 + random() * 112,
      w: 18 + intensity * 36 * amp,
      h: 26 + intensity * 46 * amp,
      o: 0.06 * amp + intensity * 0.13 * amp,
      r: -42 + random() * 84,
      drift: (index % 2 === 0 ? 1 : -1) * (2 + random() * 5),
    };
  });
}

export function atmosphereCloudVars(cloud: AtmosphereCloud): Record<`--${string}`, string> {
  return {
    "--cloud-x": `${cloud.x.toFixed(1)}%`,
    "--cloud-y": `${cloud.y.toFixed(1)}%`,
    "--cloud-w": `${cloud.w.toFixed(1)}%`,
    "--cloud-h": `${cloud.h.toFixed(1)}%`,
    "--cloud-o": cloud.o.toFixed(3),
    "--cloud-r": `${cloud.r.toFixed(1)}deg`,
    "--cloud-drift": `${cloud.drift.toFixed(2)}px`,
  };
}
