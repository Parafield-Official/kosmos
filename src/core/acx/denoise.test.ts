import { describe, expect, it } from "vitest";
import {
  afftdnFilter,
  noiseReductionAttempts,
} from "./denoise";

describe("automatic narration denoise", () => {
  it("tries only the reduction needed, then the safe cap", () => {
    expect(noiseReductionAttempts(-54, -60)).toEqual([8, 12]);
    expect(noiseReductionAttempts(-58, -60)).toEqual([4, 12]);
  });

  it("never exceeds the unattended 12 dB cap", () => {
    expect(noiseReductionAttempts(-30, -60)).toEqual([12]);
    expect(noiseReductionAttempts(Number.NaN, -60)).toEqual([12]);
  });

  it("builds an adaptive, smoothed FFT filter from the measured floor", () => {
    expect(afftdnFilter(-54.25, 8)).toBe("afftdn=nr=8:nf=-54.25:tn=1:gs=8");
  });

  it("keeps FFmpeg parameters within their safe documented ranges", () => {
    expect(afftdnFilter(-120, 100)).toBe("afftdn=nr=12:nf=-80:tn=1:gs=8");
    expect(afftdnFilter(Number.NaN, Number.NaN)).toBe("afftdn=nr=12:nf=-50:tn=1:gs=8");
  });
});
