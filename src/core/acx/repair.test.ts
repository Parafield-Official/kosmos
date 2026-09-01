import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_REPAIR_FILTER,
  AUTOMATIC_REPAIR_MAX_CHANGED_RATIO,
  assessRepairCandidate,
} from "./repair";

describe("automatic deterministic repair", () => {
  it("runs de-clip before de-click and preserves untouched samples", () => {
    expect(AUTOMATIC_REPAIR_FILTER).toBe(
      "adeclip=w=10:o=50:a=3:t=5:m=save,adeclick=w=10:o=50:a=1:t=8:m=save",
    );
  });

  it("does nothing when FFmpeg returns the source unchanged", () => {
    const source = Float32Array.from([0, 0.1, -0.2, 0.3]);

    expect(assessRepairCandidate(source, new Float32Array(source))).toMatchObject({
      applied: false,
      safe: true,
      changedSamples: 0,
      changedRatio: 0,
      levelShiftDb: 0,
    });
  });

  it("accepts a sparse, level-neutral interpolation", () => {
    const source = new Float32Array(10_000).fill(0.1);
    const candidate = new Float32Array(source);
    candidate[2_000] = 0.09;
    candidate[7_000] = 0.11;

    expect(assessRepairCandidate(source, candidate)).toMatchObject({
      applied: true,
      safe: true,
      changedSamples: 2,
      changedRatio: 0.0002,
    });
  });

  it("rejects widespread reconstruction", () => {
    const source = new Float32Array(10_000).fill(0.1);
    const candidate = new Float32Array(source);
    candidate.fill(0.09, 0, Math.ceil(source.length * AUTOMATIC_REPAIR_MAX_CHANGED_RATIO) + 1);

    expect(assessRepairCandidate(source, candidate)).toMatchObject({
      applied: true,
      safe: false,
      reason: "Detected damage is too widespread for unattended reconstruction.",
    });
  });

  it("rejects a candidate that changes programme level", () => {
    const source = new Float32Array(10_000).fill(0.01);
    const candidate = new Float32Array(source);
    candidate.fill(0.9, 0, 100);

    expect(assessRepairCandidate(source, candidate)).toMatchObject({
      applied: true,
      safe: false,
      reason: "Repair changed narration level beyond the preservation limit.",
    });
  });

  it("rejects invalid PCM and duration changes", () => {
    const source = Float32Array.from([0, 0.1, -0.2]);
    expect(assessRepairCandidate(source, Float32Array.from([0, 0.1]))).toMatchObject({
      safe: false,
      reason: "Repair changed the take length.",
    });
    expect(assessRepairCandidate(source, Float32Array.from([0, Number.NaN, -0.2]))).toMatchObject({
      safe: false,
      reason: "Repair produced invalid PCM.",
    });
  });
});
