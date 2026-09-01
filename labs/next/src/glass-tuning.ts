export type TuningField =
  | {
      id: string;
      label: string;
      cssVar: string;
      kind: "range";
      min: number;
      max: number;
      step: number;
      default: number;
      unit?: string;
      nativeOnly?: boolean;
      hostedOnly?: boolean;
      hint?: string;
    }
  | {
      id: string;
      label: string;
      kind: "select";
      default: string;
      options: { value: string; label: string }[];
      electronOnly?: boolean;
      hint?: string;
    };

export type GlassLookId = "frosted" | "transparent";

export const DEFAULT_GLASS_LOOK: GlassLookId = "frosted";
export const GLASS_LOOK_STORAGE_KEY = "kosmos-glass-look-v2";

export const GLASS_LOOKS: Record<GlassLookId, GlassTuningValues> = {
  transparent: {
    glassBlur: "27",
    glassTintNative: "0.04",
    glassTintHosted: "0.08",
    vibrancy: "under-window",
    visualEffectState: "active",
    glassSaturate: "140",
    glassBrightness: "40",
    glassContrast: "110",
    glassFrost: "0.08",
    glassGrainOpacity: "0.03",
    glassSpecular: "0.12",
    glassSplay: "34",
    glassSpecularAngle: "165",
    glassRimBorder: "0.2",
    glassRimHighlight: "0.28",
    glassDepth: "0.1",
    glassDispersion: "0",
    glassRadius: "15",
    look: "transparent",
  },
  frosted: {
    glassBlur: "48",
    glassTintNative: "0.1",
    glassTintHosted: "0.18",
    vibrancy: "fullscreen-ui",
    visualEffectState: "active",
    glassSaturate: "140",
    glassBrightness: "40",
    glassContrast: "110",
    glassFrost: "0.34",
    glassGrainOpacity: "0.14",
    glassSpecular: "0.03",
    glassSplay: "40",
    glassSpecularAngle: "165",
    glassRimBorder: "0.08",
    glassRimHighlight: "0.06",
    glassDepth: "0.12",
    glassDispersion: "0",
    glassRadius: "15",
    look: "frosted",
  },
};

export const GLASS_LOOK_OPTIONS: { id: GlassLookId; label: string }[] = [
  { id: "frosted", label: "Frosted" },
  { id: "transparent", label: "Transparent" },
];

export function isGlassLookId(value: string): value is GlassLookId {
  return value === "frosted" || value === "transparent";
}

export type TuningGroup = {
  id: string;
  title: string;
  description?: string;
  fields: TuningField[];
};

export type GlassTuningValues = Record<string, string>;

export const VIBRANCY_OPTIONS = [
  "under-window",
  "sidebar",
  "hud",
  "popover",
  "titlebar",
  "menu",
  "header",
  "sheet",
  "window",
  "content",
  "fullscreen-ui",
  "appearance-based",
  "light",
  "dark",
  "medium-light",
  "ultra-dark",
  "full-screen-ui",
] as const;

/** Slider range for frost blur — visual mix is 0 at 0px, 1 at max. */
export const GLASS_BLUR_MAX = 48;

/** Maps blur slider → OS material. Higher blur = stronger desktop melt. */
export function materialForBlur(blur: number): { vibrancy: string; visualEffectState: string } {
  const t = Math.min(1, Math.max(0, blur / GLASS_BLUR_MAX));
  if (t <= 0) {
    return { vibrancy: "popover", visualEffectState: "inactive" };
  }
  if (t < 0.28) {
    return { vibrancy: "hud", visualEffectState: "active" };
  }
  if (t < 0.55) {
    return { vibrancy: "sidebar", visualEffectState: "active" };
  }
  if (t < 0.8) {
    return { vibrancy: "under-window", visualEffectState: "active" };
  }
  return { vibrancy: "fullscreen-ui", visualEffectState: "active" };
}

export function cssBlurForNative(blur: number, visualEffectState: string): string {
  if (visualEffectState === "inactive") {
    return `${Math.max(0, blur)}px`;
  }
  return "0px";
}

export function resolveNativeMaterial(values: GlassTuningValues) {
  const blur = Number(values.glassBlur ?? 20);
  const material = materialForBlur(blur);
  return {
    ...material,
    cssBlur: cssBlurForNative(blur, material.visualEffectState),
  };
}

export const GLASS_TUNING_GROUPS: TuningGroup[] = [
  {
    id: "essentials",
    title: "Frost",
    description: "Blur is the frosted distortion of apps behind the window. Copy JSON when it looks right.",
    fields: [
      {
        id: "glassBlur",
        label: "frost blur",
        cssVar: "--glass-blur",
        kind: "range",
        min: 0,
        max: GLASS_BLUR_MAX,
        step: 1,
        default: 22,
        unit: "px",
        hint: "0 = sharp desktop + colors. Max = melted background like heavy frosted glass.",
      },
      {
        id: "glassTintNative",
        label: "--glass-tint-opacity-native",
        cssVar: "--glass-tint-opacity-native",
        kind: "range",
        min: 0,
        max: 0.7,
        step: 0.01,
        default: 0.1,
        nativeOnly: true,
      },
      {
        id: "glassTintHosted",
        label: "--glass-tint-opacity-hosted",
        cssVar: "--glass-tint-opacity-hosted",
        kind: "range",
        min: 0,
        max: 0.7,
        step: 0.01,
        default: 0.18,
        hostedOnly: true,
      },
      {
        id: "vibrancy",
        label: "vibrancy (auto from blur)",
        kind: "select",
        default: "fullscreen-ui",
        electronOnly: true,
        hint: "Follows blur slider — shown for reference",
        options: VIBRANCY_OPTIONS.map((value) => ({ value, label: value })),
      },
      {
        id: "visualEffectState",
        label: "visualEffectState",
        kind: "select",
        default: "active",
        electronOnly: true,
        options: [
          { value: "active", label: "active" },
          { value: "inactive", label: "inactive" },
        ],
      },
    ],
  },
  {
    id: "backdrop",
    title: "Backdrop filter",
    fields: [
      {
        id: "glassSaturate",
        label: "--glass-saturate",
        cssVar: "--glass-saturate",
        kind: "range",
        min: 80,
        max: 220,
        step: 1,
        default: 140,
        unit: "%",
      },
      {
        id: "glassBrightness",
        label: "--glass-brightness",
        cssVar: "--glass-brightness",
        kind: "range",
        min: 20,
        max: 120,
        step: 1,
        default: 40,
        unit: "%",
      },
      {
        id: "glassContrast",
        label: "--glass-contrast",
        cssVar: "--glass-contrast",
        kind: "range",
        min: 80,
        max: 140,
        step: 1,
        default: 110,
        unit: "%",
      },
    ],
  },
  {
    id: "frost",
    title: "Frost texture",
    fields: [
      {
        id: "glassFrost",
        label: "frost overlay",
        cssVar: "--glass-frost",
        kind: "range",
        min: 0,
        max: 0.55,
        step: 0.01,
        default: 0.16,
        hint: "Etched glass wash over the colors.",
      },
      {
        id: "glassGrainOpacity",
        label: "grain",
        cssVar: "--glass-grain-opacity",
        kind: "range",
        min: 0,
        max: 0.28,
        step: 0.001,
        default: 0.06,
        hint: "Sandblasted noise on the surface.",
      },
    ],
  },
  {
    id: "specular",
    title: "Specular",
    fields: [
      {
        id: "glassSpecular",
        label: "--glass-specular",
        cssVar: "--glass-specular",
        kind: "range",
        min: 0,
        max: 0.45,
        step: 0.01,
        default: 0.07,
      },
      {
        id: "glassSplay",
        label: "--glass-splay",
        cssVar: "--glass-splay",
        kind: "range",
        min: 8,
        max: 70,
        step: 1,
        default: 40,
        unit: "%",
      },
      {
        id: "glassSpecularAngle",
        label: "--glass-specular-angle",
        cssVar: "--glass-specular-angle",
        kind: "range",
        min: -180,
        max: 180,
        step: 1,
        default: 165,
        unit: "deg",
      },
    ],
  },
  {
    id: "rim",
    title: "Rim",
    fields: [
      {
        id: "glassRimBorder",
        label: "--glass-rim-border",
        cssVar: "--glass-rim-border",
        kind: "range",
        min: 0,
        max: 0.35,
        step: 0.01,
        default: 0.1,
      },
      {
        id: "glassRimHighlight",
        label: "--glass-rim-highlight",
        cssVar: "--glass-rim-highlight",
        kind: "range",
        min: 0,
        max: 0.35,
        step: 0.01,
        default: 0.18,
      },
    ],
  },
  {
    id: "depth",
    title: "Depth",
    fields: [
      {
        id: "glassDepth",
        label: "--glass-depth",
        cssVar: "--glass-depth",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.28,
      },
    ],
  },
  {
    id: "dispersion",
    title: "Dispersion",
    fields: [
      {
        id: "glassDispersion",
        label: "--glass-dispersion",
        cssVar: "--glass-dispersion",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.15,
      },
    ],
  },
  {
    id: "shape",
    title: "Shape",
    fields: [
      {
        id: "glassRadius",
        label: "--glass-radius",
        cssVar: "--glass-radius",
        kind: "range",
        min: 0,
        max: 40,
        step: 1,
        default: 15,
        unit: "px",
      },
    ],
  },
];

export const GLASS_TUNING_STORAGE_KEY = "kosmos-glass-tuning-v17";
const TUNING_CHANNEL = "kosmos-glass-tuning";

let tuningChannel: BroadcastChannel | null = null;

function getTuningChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }
  tuningChannel ??= new BroadcastChannel(TUNING_CHANNEL);
  return tuningChannel;
}

function cssValueForField(field: Extract<TuningField, { kind: "range" }>, value: string): string {
  return field.unit ? `${value}${field.unit}` : value;
}

/** 0 at 0px, 1 at the slider max — linear across the whole range. */
export function glassStrength(blur: number): number {
  if (blur <= 0) {
    return 0;
  }
  return Math.min(1, blur / GLASS_BLUR_MAX);
}

const STRENGTH_SCALED_FIELDS = new Set([
  "glassTintNative",
  "glassTintHosted",
]);

export function syncMaterialFields(values: GlassTuningValues): GlassTuningValues {
  if (values.vibrancy && values.visualEffectState) {
    return values;
  }
  const resolved = resolveNativeMaterial(values);
  return {
    ...values,
    vibrancy: resolved.vibrancy,
    visualEffectState: resolved.visualEffectState,
  };
}

export function valuesForLook(id: GlassLookId): GlassTuningValues {
  return { ...GLASS_LOOKS[id] };
}

export function lookFromValues(values: GlassTuningValues): GlassLookId {
  if (values.look && isGlassLookId(values.look)) {
    return values.look;
  }
  if (values.vibrancy === "fullscreen-ui" || values.glassBlur === "48") {
    return "frosted";
  }
  if (values.vibrancy === "under-window" || values.glassBlur === "27") {
    return "transparent";
  }
  return readStoredGlassLook();
}

export function readStoredGlassLook(): GlassLookId {
  try {
    const raw = localStorage.getItem(GLASS_LOOK_STORAGE_KEY);
    if (raw && isGlassLookId(raw)) {
      return raw;
    }
  } catch {
    // Private windows can refuse storage.
  }
  return DEFAULT_GLASS_LOOK;
}

export function storeGlassLook(id: GlassLookId) {
  try {
    localStorage.setItem(GLASS_LOOK_STORAGE_KEY, id);
  } catch {
    // Look still applies for the session.
  }
}

export function defaultGlassTuningValues(): GlassTuningValues {
  return valuesForLook(DEFAULT_GLASS_LOOK);
}

export function readStoredGlassTuning(): GlassTuningValues {
  return valuesForLook(readStoredGlassLook());
}

export function storeGlassTuning(values: GlassTuningValues) {
  const look = lookFromValues(values);
  const trimmed: GlassTuningValues = { look };
  for (const group of GLASS_TUNING_GROUPS) {
    for (const field of group.fields) {
      trimmed[field.id] = values[field.id] ?? String(field.default);
    }
  }
  localStorage.setItem(GLASS_TUNING_STORAGE_KEY, JSON.stringify(trimmed));
}

export function applyGlassTuning(values: GlassTuningValues, root: HTMLElement = document.documentElement) {
  const look = lookFromValues(values);
  storeGlassLook(look);
  root.dataset.glassLook = look;
  root.dataset.glassClear = "false";

  const preset = valuesForLook(look);
  const applied = look === "frosted" ? preset : { ...preset, ...values, look: "transparent" };

  for (const group of GLASS_TUNING_GROUPS) {
    for (const field of group.fields) {
      if (field.kind === "select") {
        continue;
      }
      const raw = applied[field.id] ?? String(field.default);
      root.style.setProperty(field.cssVar, cssValueForField(field, raw));
    }
  }

  if (look === "frosted") {
    root.style.setProperty("--glass-blur", "48px");
    root.style.setProperty("--glass-frost-amount", "1");
    root.style.setProperty("--glass-base-opacity", "0.22");
    root.style.setProperty("--glass-mesh-opacity", "0.90");
    root.style.setProperty("--glass-dispersion", "0");
    root.style.setProperty("--glass-frost", "0.34");
    root.style.setProperty("--glass-grain-opacity", "0.14");
    root.style.setProperty("--glass-specular", "0.03");
    return;
  }

  root.style.setProperty("--glass-blur", `${applied.glassBlur ?? "27"}px`);
  root.style.setProperty("--glass-frost-amount", "0.35");
  root.style.setProperty("--glass-base-opacity", "0.1");
  root.style.setProperty("--glass-mesh-opacity", "0.90");
  root.style.setProperty("--glass-dispersion", "0");
}

export function applyNativeMaterial(values: GlassTuningValues) {
  const look = lookFromValues(values);
  const applied = valuesForLook(look);
  const blur = Number(applied.glassBlur ?? 20);
  void window.kosmosNext?.setMaterial?.({
    vibrancy: applied.vibrancy,
    visualEffectState: applied.visualEffectState,
    blur,
    look,
    clear: false,
  });
}

export function applyGlassLook(id: GlassLookId, root: HTMLElement = document.documentElement) {
  storeGlassLook(id);
  root.dataset.glassLook = id;
  publishGlassTuning(valuesForLook(id));
}

export function publishGlassTuning(values: GlassTuningValues) {
  storeGlassTuning(values);
  applyGlassTuning(values);
  applyNativeMaterial(values);
  getTuningChannel()?.postMessage({ type: "apply", values });
  window.kosmosNext?.pushTuning?.(values);
}

export function subscribeGlassTuning(onApply: (values: GlassTuningValues) => void) {
  const ipcUnsubscribe = window.kosmosNext?.onTuningApply?.((values) => {
    storeGlassTuning(values);
    onApply(syncMaterialFields(values));
  });

  const channel = getTuningChannel();
  if (!channel) {
    return () => {
      ipcUnsubscribe?.();
    };
  }
  const handler = (event: MessageEvent<{ type?: string; values?: GlassTuningValues }>) => {
    if (event.data?.type !== "apply" || !event.data.values) {
      return;
    }
    storeGlassTuning(event.data.values);
    onApply(syncMaterialFields(event.data.values));
  };
  channel.addEventListener("message", handler);
  return () => {
    ipcUnsubscribe?.();
    channel.removeEventListener("message", handler);
  };
}

export function formatGlassTuningExport(values: GlassTuningValues): string {
  const trimmed: GlassTuningValues = {};
  for (const group of GLASS_TUNING_GROUPS) {
    for (const field of group.fields) {
      trimmed[field.id] = values[field.id] ?? String(field.default);
    }
  }
  return JSON.stringify(trimmed, null, 2);
}
