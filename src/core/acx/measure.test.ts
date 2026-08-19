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
    expect(report.noise_floor_start_seconds).toBeGreaterThanOrEqual(0);
    expect(report.noise_floor_duration_seconds).toBeGreaterThanOrEqual(0.1);
  });

  it("identifies the sustained quiet window used for the noise-floor result", () => {
    const sampleRate = 1_000;
    const loud = new Array(500).fill(0.1);
    const quiet = new Array(300).fill(0.0001);
    const report = measurePcm({
      samples: Float32Array.from([...loud, ...quiet, ...loud]),
      sampleRate,
      channels: 1,
    });

    expect(report.noise_floor_dbfs).toBeCloseTo(-80, 1);
    expect(report.noise_floor_start_seconds).toBeCloseTo(0.5, 1);
    expect(report.noise_floor_duration_seconds).toBeCloseTo(0.3, 1);
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

  it("does not give an unclassified source a false green format check", () => {
    const report = measurePcm({
      samples: new Float32Array(44100).fill(0.1),
      sampleRate: 44100,
      channels: 1,
    });

    expect(report.checks.format).toBe("warn");
  });

  it("does not apply MP3 bitrate rules to a known lossless source", () => {
    const report = measurePcm({
      samples: new Float32Array(44100).fill(0.1),
      sampleRate: 44100,
      channels: 1,
      format: "flac",
      bitrate_kbps: 96,
    });

    expect(report.checks.format).toBe("pass");
  });

  it("rejects a runtime format that is outside the accepted source set", () => {
    const report = measurePcm({
      samples: new Float32Array(44100).fill(0.1),
      sampleRate: 44100,
      channels: 1,
      format: "ogg" as never,
    });

    expect(report.checks.format).toBe("fail");
  });

  it("does not loop forever or emit NaN metadata for malformed decoder values", () => {
    const report = measurePcm({
      samples: new Float32Array([0, 0.1, 0]),
      sampleRate: Number.NaN,
      channels: Number.NaN,
    });

    expect(report.sample_rate).toBe(0);
    expect(report.channels).toBe(0);
    expect(report.checks.sample_rate).toBe("fail");
    expect(report.checks.channels).toBe("fail");
  });

  it("rejects an incomplete interleaved audio frame", () => {
    const report = measurePcm({
      samples: new Float32Array([0, 0, 0]),
      sampleRate: 44_100,
      channels: 2,
    });
    expect(report.checks.channels).toBe("fail");
  });

  it("does not require room tone on a retail sample that starts on narration", () => {
    const report = measurePcm({
      samples: new Float32Array(44100).fill(0.1),
      sampleRate: 44100,
      channels: 1,
      format: "mp3",
      bitrate_kbps: 192,
      vbr: false,
    }, { requireRoomTone: false });

    expect(report.checks.head_room_tone).toBe("pass");
    expect(report.checks.tail_room_tone).toBe("pass");
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

  it("fails meter checks when PCM contains non-finite samples instead of passing NaN comparisons", () => {
    const report = measurePcm({
      samples: Float32Array.from([0.1, Number.NaN, 0.1]),
      sampleRate: 44_100,
      channels: 1,
    });

    expect(report.checks.rms).toBe("fail");
    expect(report.checks.true_peak).toBe("fail");
    expect(report.checks.noise_floor).toBe("fail");
    expect(report.traffic_light).toBe("red");
  });
});
