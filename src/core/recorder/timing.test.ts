import { describe, expect, it } from "vitest";
import { recordingElapsedSeconds } from "./timing";

describe("recorder elapsed-time clock", () => {
  it("subtracts every completed pause, not only the most recent one", () => {
    const started = 1_000;
    const firstPause = 3_000;
    const firstResume = 4_000;
    const secondPause = 6_000;
    const secondResume = 7_500;
    const completedPauses = (firstResume - firstPause) + (secondResume - secondPause);

    expect(recordingElapsedSeconds(9_500, started, completedPauses)).toBeCloseTo(6, 6);
  });

  it("freezes the clock while a pause is active", () => {
    expect(recordingElapsedSeconds(7_000, 1_000, 0, 5_000)).toBeCloseTo(4, 6);
  });

  it("does not produce negative or NaN durations for malformed clock values", () => {
    expect(recordingElapsedSeconds(Number.NaN, 1_000)).toBe(0);
    expect(recordingElapsedSeconds(500, 1_000)).toBe(0);
  });
});
