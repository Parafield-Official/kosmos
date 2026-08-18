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

  it("rejects VBR MP3 metadata even when the bitrate is high enough", () => {
    const samples = new Float32Array(44100).fill(0.1);
    const report = measurePcm({
      samples,
      sampleRate: 44100,
      channels: 1,
      format: "mp3",
      bitrate_kbps: 256,
      vbr: true,
    });

    expect(report.checks.format).toBe("fail");
  });

  it("warns when a leading or trailing pad is digital silence", () => {
    const sampleRate = 1000;
    const head = new Array(600).fill(0.001);
    const speech = new Array(600).fill(0.1);
    const tail = new Array(600).fill(0);
    const report = measurePcm({
      samples: new Float32Array([...head, ...speech, ...tail]),
      sampleRate,
      channels: 1,
    });

    expect(report.tail_room_tone_is_digital_silence).toBe(true);
    expect(report.checks.tail_room_tone).toBe("fail");
  });
});
