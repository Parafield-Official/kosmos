import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  DEPTH_X,
  LIGHT_RADIUS,
  LIGHT_RANGE,
  WORLD_DEPTH,
  columnCenterBackU,
  distanceAttenuation,
  lightOpeningU,
  lightWorldX,
  lightWorldZ,
  occupiedMask,
  spotFactor,
} from "./vault-light-layout";

describe("vault lighting layout", () => {
  it("centers the middle fixture on the opening", () => {
    expect(lightOpeningU(2)).toBeCloseTo(0.5, 3);
    expect(lightWorldX(2)).toBeCloseTo(columnCenterBackU(2), 5);
  });

  it("places one fixture per column, symmetric about the center", () => {
    expect(COLUMNS).toBe(5);
    expect(lightWorldX(0)).toBeCloseTo(1 - lightWorldX(4), 3);
    expect(lightWorldX(1)).toBeCloseTo(1 - lightWorldX(3), 3);
    expect(lightOpeningU(0)).toBeGreaterThan(DEPTH_X);
    expect(lightOpeningU(4)).toBeLessThan(1 - DEPTH_X);
  });

  it("puts the lamps in the ceiling, in front of the back wall", () => {
    expect(lightWorldZ()).toBeLessThan(0);
    expect(lightWorldZ()).toBeGreaterThan(-WORLD_DEPTH);
  });

  it("falls off from the beam center and reaches zero at range", () => {
    const near = distanceAttenuation(0.2, LIGHT_RANGE, LIGHT_RADIUS);
    const far = distanceAttenuation(0.9, LIGHT_RANGE, LIGHT_RADIUS);
    expect(near).toBeGreaterThan(far);
    expect(distanceAttenuation(LIGHT_RANGE, LIGHT_RANGE, LIGHT_RADIUS)).toBe(0);
  });

  it("keeps the top row closer to the lamps than the bottom row", () => {
    const height = 0.58;
    const lampY = height;
    const topY = height * 0.78;
    const bottomY = height * 0.18;
    const lampZ = lightWorldZ();
    const backZ = -WORLD_DEPTH;
    const top = Math.hypot(lampY - topY, lampZ - backZ);
    const bottom = Math.hypot(lampY - bottomY, lampZ - backZ);
    expect(top).toBeLessThan(bottom);
    expect(distanceAttenuation(top, LIGHT_RANGE, LIGHT_RADIUS)).toBeGreaterThan(
      distanceAttenuation(bottom, LIGHT_RANGE, LIGHT_RADIUS),
    );
  });

  it("softens the spot cone between inner and outer angles", () => {
    const inner = Math.cos((14 * Math.PI) / 180);
    const outer = Math.cos((40 * Math.PI) / 180);
    expect(spotFactor(1, inner, outer)).toBe(1);
    expect(spotFactor(outer, inner, outer)).toBe(0);
    const mid = spotFactor((inner + outer) / 2, inner, outer);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
  });

  it("packs occupied niches as a bit mask", () => {
    expect(occupiedMask([true, false, true])).toBe(0b101);
    expect(occupiedMask(Array.from({ length: 15 }, (_, i) => i === 14))).toBe(1 << 14);
  });
});
