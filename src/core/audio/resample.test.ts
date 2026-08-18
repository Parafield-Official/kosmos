import { describe, expect, it } from "vitest";
import { resamplePcmToMono } from "./resample";

describe("live PCM resampling", () => {
  it("keeps a mono signal unchanged when the rates match", () => {
    const input = new Float32Array([0, 0.5, -0.5, 1]);
    expect(Array.from(resamplePcmToMono(input, 16_000, 16_000))).toEqual(Array.from(input));
  });

  it("creates a bounded output for a different input rate", () => {
    const output = resamplePcmToMono(new Float32Array([0, 1, 0, -1]), 4, 8);
    expect(output.length).toBe(8);
    expect(output.every((sample) => Number.isFinite(sample) && sample >= -1 && sample <= 1)).toBe(true);
  });

  it("returns no samples for empty or invalid input", () => {
    expect(resamplePcmToMono(new Float32Array(), 48_000, 16_000)).toHaveLength(0);
    expect(resamplePcmToMono(new Float32Array([1]), 0, 16_000)).toHaveLength(1);
  });
});
