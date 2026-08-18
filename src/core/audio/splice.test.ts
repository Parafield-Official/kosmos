import { describe, expect, it } from "vitest";
import { splicePunch, trimPunchSilence } from "./splice";

describe("offline punch splice", () => {
  it("returns a new edited take, keeps the raw input untouched, and crossfades the seam", () => {
    const raw = Float32Array.from({ length: 100 }, (_, index) => index / 100);
    const replacement = new Float32Array(20).fill(-0.5);
    const before = new Float32Array(raw);

    const edited = splicePunch({
      original: raw,
      replacement,
      sampleRate: 100,
      startSeconds: 0.4,
      endSeconds: 0.6,
      crossfadeMs: 20,
    });

    expect(raw).toEqual(before);
    expect(edited).toHaveLength(96);
    expect(edited[38]).toBeGreaterThan(edited[39]);
    expect(edited[39]).toBeGreaterThan(edited[40]);
    expect(edited[39]).toBeGreaterThan(-0.5);
    expect(edited.at(-1)).toBeCloseTo(0.99, 5);
  });

  it("trims room noise around a replacement while retaining a speech pad", () => {
    const samples = Float32Array.from([
      0, 0.001, 0.001, 0.01, 0.2, 0.3, 0.2, 0.01, 0.001, 0,
    ]);
    const trimmed = trimPunchSilence(samples, 10, { threshold: 0.02, padMs: 100 });

    expect(Array.from(trimmed)).toHaveLength(5);
    expect(trimmed[0]).toBeCloseTo(0.01, 5);
    expect(trimmed[2]).toBeCloseTo(0.3, 5);
    expect(trimmed[4]).toBeCloseTo(0.01, 5);
  });
});
