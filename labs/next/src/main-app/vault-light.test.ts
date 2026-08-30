import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  DEPTH_X,
  LIGHT_RADIUS,
  LIGHT_RANGE,
  WORLD_DEPTH,
  distanceAttenuation,
  lightAim,
  lightOpeningU,
  lightPos,
  lightWorldX,
  lightWorldZ,
  occupiedMask,
  slotLight,
  spotFactor,
} from "./vault-light-layout";

describe("vault lighting layout", () => {
  it("centers the middle fixture on the opening", () => {
    expect(lightOpeningU(2)).toBeCloseTo(0.5, 3);
    expect(lightWorldX(2)).toBeCloseTo(lightOpeningU(2), 5);
    expect(lightWorldX(2)).toBeCloseTo(0.5, 3);
  });

  it("places one fixture per column, symmetric about the center", () => {
    expect(COLUMNS).toBe(5);
    expect(lightWorldX(0)).toBeCloseTo(1 - lightWorldX(4), 3);
    expect(lightWorldX(1)).toBeCloseTo(1 - lightWorldX(3), 3);
    expect(lightOpeningU(0)).toBeGreaterThan(DEPTH_X);
    expect(lightOpeningU(4)).toBeLessThan(1 - DEPTH_X);
  });

  it("sits the cans in the middle of the soffit, not on the inner wall", () => {
    expect(lightWorldZ()).toBeCloseTo(-WORLD_DEPTH * 0.5, 5);
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
    const inner = Math.cos((12 * Math.PI) / 180);
    const outer = Math.cos((42 * Math.PI) / 180);
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

  it("aims each gimbal down into the room, not at the back-wall top", () => {
    const lamp = lightPos(2);
    const aim = lightAim(2);
    expect(aim.y).toBeLessThan(lamp.y);
    expect(aim.z).toBeLessThan(lamp.z);
    expect(aim.z).toBeGreaterThan(-WORLD_DEPTH);
    expect(aim.y).toBeLessThan(lamp.y * 0.95);
  });

  it("places each lamp on the opening UV of its ceiling can", () => {
    expect(lightPos(0).x).toBeCloseTo(lightOpeningU(0), 5);
    expect(lightPos(2).x).toBeCloseTo(0.5, 3);
    expect(lightPos(0).x).toBeGreaterThan(DEPTH_X);
  });

  it("keeps each beam on its fixture axis", () => {
    expect(Math.abs(lightAim(0).x - lightPos(0).x)).toBeLessThan(0.001);
    expect(Math.abs(lightAim(2).x - lightPos(2).x)).toBeLessThan(0.001);
    expect(Math.abs(lightAim(4).x - lightPos(4).x)).toBeLessThan(0.001);
  });

  it("still reaches the bottom row, weaker than the top", () => {
    const top = slotLight(0, 2).irr;
    const mid = slotLight(1, 2).irr;
    const bottom = slotLight(2, 2).irr;
    expect(top).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(bottom);
    expect(bottom).toBeGreaterThan(0);
  });

  it("lights a column more from its own fixture than from a far one", () => {
    const onlyCenter = 1 << 2;
    expect(slotLight(0, 2, undefined, onlyCenter).irr).toBeGreaterThan(slotLight(0, 0, undefined, onlyCenter).irr);
  });
});
