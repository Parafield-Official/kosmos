import { describe, expect, it } from "vitest";
import { measurePcm, samplePeakDbfs } from "./measure";

describe("ACX measurement", () => {
  it("rejects an inter-sample true peak even when the sample peak is below -3 dBFS", () => {
    // A short, band-limited edge fixture. The stored samples are below -3 dBFS,
    // but reconstruction between samples crosses the ACX ceiling.
    const samples = new Float32Array([0, 0.692, -0.692, 0.692, -0.692, 0]);
    const samplePeak = samplePeakDbfs(samples);
    const report = measurePcm({ samples, sampleRate: 44100, channels: 1 });

    expect(samplePeak).toBeLessThan(-3);
    expect(report.true_peak_dbfs).toBeGreaterThan(-3);
    expect(report.checks.true_peak).toBe("fail");
  });

  it("computes whole-file RMS and flags a non-ACX sample rate", () => {
    const samples = new Float32Array(4800).fill(0.1);
    const report = measurePcm({ samples, sampleRate: 48000, channels: 1 });

    expect(report.rms_dbfs).toBeCloseTo(-20, 1);
    expect(report.sample_rate).toBe(48000);
    expect(report.checks.sample_rate).toBe("fail");
  });
});

