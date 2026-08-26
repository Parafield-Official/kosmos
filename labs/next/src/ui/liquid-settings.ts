/** Unique liquid-glass settings for Kosmos Next chrome. Clear iOS: see-through fill, bright rim, edge refraction. No warm/orange strokes. */

export const liquidSettings = {
  blur: "12px",
  saturate: "180%",
  brightness: "1.08",
  contrast: "1.06",
  fillTop: "rgba(255, 255, 255, 0.16)",
  fillMid: "rgba(255, 255, 255, 0.04)",
  fillBottom: "rgba(255, 255, 255, 0.07)",
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

export type LiquidSettings = typeof liquidSettings;

export function liquidVars(settings: LiquidSettings = liquidSettings): Record<string, string> {
  return {
    "--liquid-blur": settings.blur,
    "--liquid-saturate": settings.saturate,
    "--liquid-brightness": settings.brightness,
    "--liquid-contrast": settings.contrast,
    "--liquid-fill-top": settings.fillTop,
    "--liquid-fill-mid": settings.fillMid,
    "--liquid-fill-bottom": settings.fillBottom,
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
