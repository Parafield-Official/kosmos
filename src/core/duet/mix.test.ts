import { describe, expect, it } from "vitest";
import { mixDuetTracks, type DuetSegment } from "./mix";

describe("duet seat mixer", () => {
  it("selects seats by timeline, preserves stems, and crossfades boundaries", () => {
    const n1 = Float32Array.from({ length: 12 }, () => 0.25);
    const n2 = Float32Array.from({ length: 12 }, () => -0.5);
    const segments: DuetSegment[] = [
      { start: 0, end: 0.5, seat: "N1" },
      { start: 0.5, end: 1, seat: "N2" },
    ];
    const result = mixDuetTracks({ n1, n2, sampleRate: 12, segments, crossfadeMs: 250 });

    expect(result.n1Stem[0]).toBeCloseTo(0.25);
    expect(result.n1Stem[7]).toBe(0);
    expect(result.n2Stem[0]).toBe(0);
    expect(result.n2Stem[7]).toBeCloseTo(-0.5);
    expect(result.mix[0]).toBeCloseTo(0.25);
    expect(result.mix[11]).toBeCloseTo(-0.5);
    expect(result.mix[6]).toBeGreaterThan(-0.5);
    expect(result.mix[6]).toBeLessThan(0.25);
  });

  it("uses the chosen narration seat for narration segments and validates track lengths", () => {
    const n1 = Float32Array.from([1, 1, 1, 1]);
    const n2 = Float32Array.from([2, 2, 2, 2]);
    const result = mixDuetTracks({
      n1,
      n2,
      sampleRate: 4,
      segments: [{ start: 0, end: 1, seat: "narration" }],
      narrationSeat: "N2",
      crossfadeMs: 0,
    });
    expect(Array.from(result.mix)).toEqual([2, 2, 2, 2]);
    expect(() => mixDuetTracks({ n1, n2: new Float32Array(3), sampleRate: 4, segments: [] })).toThrow(/same length/i);
  });
});
