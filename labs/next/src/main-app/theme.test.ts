import { describe, expect, it } from "vitest";
import {
  PIGMENT_BOUNDS,
  atmosphereClouds,
  clampPigmentHex,
  hslFromHex,
  parseHexColor,
  pigmentHexFromHsl,
  rgbToHsl,
} from "./theme";

describe("pigment colour math", () => {
  it("parses 3 and 6 digit hex", () => {
    expect(parseHexColor("#1a3")).toEqual({ r: 17, g: 170, b: 51 });
    expect(parseHexColor("50384c")).toEqual({ r: 80, g: 56, b: 76 });
    expect(parseHexColor("not-a-color")).toBeNull();
  });

  it("keeps mixed pigments inside the dark atmosphere range", () => {
    const neon = clampPigmentHex("#ffe600");
    const hsl = hslFromHex(neon);
    expect(hsl.s).toBeGreaterThanOrEqual(PIGMENT_BOUNDS.satMin - 0.01);
    expect(hsl.s).toBeLessThanOrEqual(PIGMENT_BOUNDS.satMax + 0.01);
    expect(hsl.l).toBeGreaterThanOrEqual(PIGMENT_BOUNDS.lightMin - 0.01);
    expect(hsl.l).toBeLessThanOrEqual(PIGMENT_BOUNDS.lightMax + 0.01);
  });

  it("round-trips a dark plum through hsl", () => {
    const hex = pigmentHexFromHsl(318, 0.18, 0.27);
    const rgb = parseHexColor(hex);
    expect(rgb).not.toBeNull();
    const hsl = rgbToHsl(rgb!.r, rgb!.g, rgb!.b);
    expect(hsl.h).toBeGreaterThan(300);
    expect(hsl.h).toBeLessThan(340);
    expect(hsl.l).toBeGreaterThan(0.2);
    expect(hsl.l).toBeLessThan(0.3);
  });
});

describe("atmosphere mesh", () => {
  it("repeats for a seed and diverges for another", () => {
    const first = atmosphereClouds(42, 6, 1);
    const again = atmosphereClouds(42, 6, 1);
    const other = atmosphereClouds(99, 6, 1);
    expect(first).toEqual(again);
    expect(first[0]).not.toEqual(other[0]);
  });

  it("lets intensity drive both size and opacity", () => {
    const clouds = atmosphereClouds(7, 8, 1);
    const strongest = clouds.reduce((max, cloud) => (cloud.o > max.o ? cloud : max));
    const faintest = clouds.reduce((min, cloud) => (cloud.o < min.o ? cloud : min));
    expect(strongest.w).toBeGreaterThan(faintest.w);
    expect(strongest.h).toBeGreaterThan(faintest.h);
  });

  it("gains plaster visibility without blowing past a wash", () => {
    const ui = atmosphereClouds(3, 6, 1);
    const plaster = atmosphereClouds(3, 6, 1.85);
    const mean = (list: typeof ui) => list.reduce((sum, cloud) => sum + cloud.o, 0) / list.length;
    expect(mean(plaster)).toBeGreaterThan(mean(ui));
    expect(Math.max(...plaster.map((cloud) => cloud.o))).toBeLessThan(0.55);
  });
});
