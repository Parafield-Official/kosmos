/** Unique liquid-glass settings for Kosmos Next chrome. Clear iOS: see-through fill, bright rim, edge refraction. No warm/orange strokes. */

export const liquidSettings = {
  blur: "12px",
  saturate: "180%",
  brightness: "1.08",
  contrast: "1.06",
  fillTop: "rgba(255, 255, 255, 0.22)",
  fillMid: "rgba(255, 255, 255, 0.08)",
  fillBottom: "rgba(255, 255, 255, 0.12)",
  meshA: "rgba(206, 158, 214, 0.42)",
  meshB: "rgba(255, 172, 138, 0.5)",
  well: "rgba(8, 10, 18, 0.12)",
  rim: "rgba(255, 255, 255, 0.46)",
  rimInner: "rgba(255, 255, 255, 0.58)",
  rimShade: "rgba(255, 255, 255, 0.1)",
  spec: "rgba(255, 255, 255, 0.55)",
  refract: "rgba(186, 220, 255, 0.42)",
  refractHot: "rgba(255, 255, 255, 0.7)",
  shadow: "rgba(0, 0, 0, 0.22)",
  radiusPill: "999px",
} as const;

/** Colourless pane: bend + fringe come from the SVG filter, not a tint. */
export const clearLiquidSettings: LiquidSettings = {
  ...liquidSettings,
  blur: "1.2px",
  saturate: "128%",
  brightness: "1.04",
  contrast: "1.08",
  fillTop: "rgba(255, 255, 255, 0.16)",
  fillMid: "rgba(255, 255, 255, 0.03)",
  fillBottom: "rgba(255, 255, 255, 0.07)",
  meshA: "transparent",
  meshB: "transparent",
  well: "transparent",
  rim: "rgba(255, 255, 255, 0.78)",
  rimInner: "rgba(255, 255, 255, 0.94)",
  rimShade: "rgba(255, 255, 255, 0.22)",
  spec: "rgba(255, 255, 255, 0.88)",
  refract: "rgba(170, 205, 255, 0.62)",
  refractHot: "rgba(255, 255, 255, 0.96)",
  shadow: "rgba(40, 36, 30, 0.12)",
};

/** Dark frosted capsule: Image-3 docks. White glyphs, no chromatic fringe. */
export const frostSettings: LiquidSettings = {
  ...liquidSettings,
  blur: "14px",
  saturate: "112%",
  brightness: "1.02",
  contrast: "1.04",
  fillTop: "rgba(72, 70, 76, 0.64)",
  fillMid: "rgba(48, 46, 52, 0.56)",
  fillBottom: "rgba(40, 38, 44, 0.62)",
  meshA: "transparent",
  meshB: "transparent",
  well: "transparent",
  rim: "rgba(255, 255, 255, 0.18)",
  rimInner: "rgba(255, 255, 255, 0.28)",
  rimShade: "rgba(255, 255, 255, 0.08)",
  spec: "rgba(255, 255, 255, 0.2)",
  refract: "transparent",
  refractHot: "transparent",
  shadow: "rgba(20, 18, 22, 0.22)",
  radiusPill: "999px",
};

export type LiquidSettings = { [K in keyof typeof liquidSettings]: string };

export function liquidVars(settings: LiquidSettings = liquidSettings): Record<string, string> {
  return {
    "--liquid-blur": settings.blur,
    "--liquid-saturate": settings.saturate,
    "--liquid-brightness": settings.brightness,
    "--liquid-contrast": settings.contrast,
    "--liquid-fill-top": settings.fillTop,
    "--liquid-fill-mid": settings.fillMid,
    "--liquid-fill-bottom": settings.fillBottom,
    "--liquid-mesh-a": settings.meshA,
    "--liquid-mesh-b": settings.meshB,
    "--liquid-well": settings.well,
    "--liquid-rim": settings.rim,
    "--liquid-rim-inner": settings.rimInner,
    "--liquid-rim-shade": settings.rimShade,
    "--liquid-spec": settings.spec,
    "--liquid-refract": settings.refract,
    "--liquid-refract-hot": settings.refractHot,
    "--liquid-shadow": settings.shadow,
    "--liquid-radius": settings.radiusPill,
  };
}
