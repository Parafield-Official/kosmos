import { describe, expect, it } from "vitest";
import { masteringStructuralFailure, masterPcm } from "./master";
import { EBU_R128_PRESET } from "./presets";
import { measurePcm } from "./measure";
import { decodeWavPcm16, encodeWavPcm16 } from "../audio/wav";

describe("ACX master chain", () => {
  it("gates non-speech before gain and keeps the processing order explicit", () => {
    const result = masterPcm({
      samples: audioBabbleFixture(),
      sampleRate: 44100,
      channels: 1,
    });

    expect(result.processing_order).toEqual([
      "decode",
      "resample",
      "mix_mono",
      "gate_non_speech",
      "compress",
      "normalize_rms",
      "true_peak_limit",
      "room_tone_pad",
    ]);
    expect(result.status).toBe("ok");
    expect(result.after?.noise_floor_dbfs).toBeLessThanOrEqual(-60);
    expect(result.after?.rms_dbfs).toBeGreaterThanOrEqual(-23);
    expect(result.after?.rms_dbfs).toBeLessThanOrEqual(-18);
    expect(result.speech_rms_after_dbfs).toBeGreaterThan(-24);
    expect(result.speech_rms_after_dbfs).toBeLessThan(-10);
  });

  it("keeps a report of the take as it arrived, not of the resampled mono copy", () => {
    const stereo = new Float32Array(16_000 * 2 * 3);
    const mono = audioBabbleFixture();
    for (let frame = 0; frame < stereo.length / 2; frame += 1) {
      const value = mono[Math.floor((frame * mono.length) / (stereo.length / 2))] ?? 0;
      stereo[frame * 2] = value;
      stereo[frame * 2 + 1] = value;
    }

    const result = masterPcm({ samples: stereo, sampleRate: 16_000, channels: 2, format: "wav" });

    // `before` cannot show either change: the gain maths needs mono at 44.1 kHz.
    expect(result.before.sample_rate).toBe(44_100);
    expect(result.before.channels).toBe(1);
    expect(result.source.sample_rate).toBe(16_000);
    expect(result.source.channels).toBe(2);
    expect(result.source.format).toBe("wav");
    expect(result.source.checks.sample_rate).toBe("fail");
    expect(result.after?.sample_rate).toBe(44_100);
    expect(result.after?.channels).toBe(1);
  });

  it("masters EBU R 128 by LUFS at 48 kHz without ACX room-tone rules", () => {
    const result = masterPcm({
      samples: audioBabbleFixture(),
      sampleRate: 44_100,
      channels: 1,
      format: "wav",
    }, { preset: EBU_R128_PRESET });

    expect(result.status).toBe("ok");
    expect(result.sampleRate).toBe(48_000);
    expect(result.after?.checks.loudness).toBe("pass");
    expect(result.after?.lufs_integrated).toBeGreaterThanOrEqual(-23.5);
    expect(result.after?.lufs_integrated).toBeLessThanOrEqual(-22.5);
    expect(result.after?.checks.true_peak).toBe("pass");
    expect(result.after?.checks.rms).toBe("unspecified");
    expect(result.after?.checks.head_room_tone).toBe("unspecified");
  });

  it("does not destroy a take when the noise is present during every speech frame", () => {
    const result = masterPcm({
      samples: bathroomFixture(),
      sampleRate: 44100,
      channels: 1,
    });

    expect(result.status).toBe("aborted");
    expect(result.abort_reason).toMatch(/room|noise|voice/i);
    expect(result.samples).toHaveLength(0);
  });

  it("rejects malformed decoder metadata before resampling can allocate an invalid buffer", () => {
    expect(() => masterPcm({
      samples: new Float32Array([0, 0.1]),
      sampleRate: Number.NaN,
      channels: 1,
    })).toThrow(/sample rate/i);
  });

  it("rejects truncated interleaved frames and non-finite samples", () => {
    expect(() => masterPcm({
      samples: new Float32Array([0, 0.1, 0.2]),
      sampleRate: 44_100,
      channels: 2,
    })).toThrow(/divisible|channel/i);
    expect(() => masterPcm({
      samples: new Float32Array([0, Number.NaN]),
      sampleRate: 44_100,
      channels: 1,
    })).toThrow(/finite/i);
  });

  it.each([0.031, 1])("masters quiet narration with an isolated peak at %s seconds without turning down the entire take", (peakSeconds) => {
    const sampleRate = 44_100;
    const samples = new Float32Array(sampleRate * 3);
    for (let index = 0; index < samples.length; index += 1) {
      const inSpeech = index >= sampleRate / 2 && index < sampleRate * 2.5;
      samples[index] = inSpeech ? 0.03 * Math.sin((2 * Math.PI * 220 * index) / sampleRate) : 0.0001;
    }
    // Include a startup impulse before narration, as in the second iPhone take.
    samples[Math.round(sampleRate * peakSeconds)] = 1;

    const result = masterPcm({ samples, sampleRate, channels: 1 });

    expect(result.status).toBe("ok");
    expect(result.after?.checks.rms).toBe("pass");
    expect(result.after?.true_peak_dbfs).toBeLessThanOrEqual(-3.2 + 1e-6);
    expect(result.after?.rms_dbfs).toBeGreaterThanOrEqual(-23);
  });

  it("does not recycle a speech fragment as room tone when the source pads are digital zero", () => {
    const sampleRate = 1_000;
    const samples = new Float32Array([
      ...new Array(500).fill(0),
      ...Array.from({ length: 1_000 }, (_value, index) => 0.15 * Math.sin((2 * Math.PI * 7 * index) / sampleRate)),
      ...new Array(500).fill(0),
    ]);

    const result = masterPcm({ samples, sampleRate, channels: 1 });

    expect(result.status).toBe("ok");
    const head = Array.from(result.samples.slice(0, 1_500));
    expect(Math.max(...head.map((value) => Math.abs(value)))).toBeLessThan(0.001);
    expect(head.some((value) => value < 0)).toBe(true);
    expect(head.some((value) => value > 0)).toBe(true);
  });

  it("still refuses a level target that cannot fit below the peak ceiling", () => {
    const result = masterPcm({
      samples: audioBabbleFixture(), sampleRate: 44_100, channels: 1,
    }, { limiterCeilingDbfs: -30 });
    expect(result.status).toBe("aborted");
    expect(result.abort_code).toBe("level");
    expect(result.abort_reason).toMatch(/RMS.*peaks.*Review/);
    expect(result.samples).toHaveLength(0);
  });

  it.each([false, true])("masters floating-point narration with near-silent edited gaps through PCM16 delivery (varying=%s)", (varying) => {
    const sampleRate = 44_100;
    const samples = new Float32Array(sampleRate * 8);
    for (let i = 0; i < samples.length; i += 1) {
      const t = i / sampleRate;
      const speaking = (t >= 1 && t < 3) || (t >= 4 && t < 7);
      // Quiet edits vary below the PCM16 floor; faint edge audio must survive.
      const quietLevel = varying && Math.floor(t / 0.02) % 2 ? -96 : -110;
      const level = speaking ? -24 : t < 0.04 || t > 7.96 ? -74 : quietLevel;
      samples[i] = Math.SQRT2 * 10 ** (level / 20) * Math.sin(2 * Math.PI * 220 * t);
    }
    const result = masterPcm({ samples, sampleRate, channels: 1 });
    expect(result.status, result.abort_reason).toBe("ok");
    expect(result.samples.length).toBeGreaterThanOrEqual(samples.length);
    expect(result.after?.checks.head_room_tone).toBe("pass");
    expect(result.after?.checks.tail_room_tone).toBe("pass");
    const decoded = decodeWavPcm16(encodeWavPcm16(result.samples, sampleRate, 1));
    const delivered = measurePcm({ ...decoded, format: "wav" });
    expect(delivered.checks.rms).toBe("pass");
    expect(delivered.checks.head_room_tone).toBe("pass");
    expect(delivered.checks.tail_room_tone).toBe("pass");
  });

  it("adds valid room tone when narration starts and ends at the recording edges", () => {
    const result = masterPcm({
      samples: edgeToEdgeNarrationFixture(),
      sampleRate: 2_000,
      channels: 1,
    });

    expect(result.status).toBe("ok");
    expect(result.after?.head_room_tone_s).toBeGreaterThanOrEqual(1.5);
    expect(result.after?.tail_room_tone_s).toBeGreaterThanOrEqual(1.5);
    expect(result.after?.checks.head_room_tone).toBe("pass");
    expect(result.after?.checks.tail_room_tone).toBe("pass");
  });

  it("treats duration and room-tone failures as a mastering abort, not a green result", () => {
    const failure = masteringStructuralFailure({
      checks: {
        rms: "pass",
        loudness: "unspecified",
        true_peak: "pass",
        noise_floor: "pass",
        sample_rate: "pass",
        channels: "pass",
        duration: "fail",
        format: "warn",
        head_room_tone: "pass",
        tail_room_tone: "fail",
      },
    });
    expect(failure).toMatch(/duration|tail room tone/i);
    expect(masteringStructuralFailure({
      checks: {
        rms: "pass",
        loudness: "unspecified",
        true_peak: "pass",
        noise_floor: "pass",
        sample_rate: "pass",
        channels: "pass",
        duration: "pass",
        format: "warn",
        head_room_tone: "pass",
        tail_room_tone: "pass",
      },
    })).toBeUndefined();
  });
});

function audioBabbleFixture(): Float32Array {
  const sampleRate = 44100;
  const noiseAmplitude = 10 ** (-42 / 20);
  const output: number[] = [];
  let seed = 11;
  const pushNoise = (seconds: number) => {
    for (let index = 0; index < Math.round(seconds * sampleRate); index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      output.push((((seed / 0xffffffff) * 2) - 1) * noiseAmplitude);
    }
  };
  const pushSpeech = (seconds: number, frequency: number) => {
    const length = Math.round(seconds * sampleRate);
    for (let index = 0; index < length; index += 1) {
      const speech = 0.18 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = ((((seed / 0xffffffff) * 2) - 1) * noiseAmplitude);
      output.push(speech + noise);
    }
  };
  pushNoise(0.45);
  pushSpeech(0.65, 180);
  pushNoise(0.3);
  pushSpeech(0.65, 220);
  pushNoise(0.3);
  pushSpeech(0.65, 160);
  pushNoise(0.45);
  return Float32Array.from(output);
}

function bathroomFixture(): Float32Array {
  const sampleRate = 44100;
  const noiseAmplitude = 10 ** (-42 / 20);
  const output = new Float32Array(sampleRate * 2);
  let seed = 23;
  for (let index = 0; index < output.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = ((((seed / 0xffffffff) * 2) - 1) * noiseAmplitude);
    output[index] = 0.055 * Math.sin((2 * Math.PI * 180 * index) / sampleRate) + noise;
  }
  return output;
}

/**
 * A coarse 40 ms RMS envelope captured from the edges of a real failed take.
 * It contains no speech content, only level changes represented by a sine wave.
 */
function edgeToEdgeNarrationFixture(): Float32Array {
  const sampleRate = 2_000;
  const frameSize = Math.round(sampleRate * 0.02);
  const blockLevelsDbfs = [
    -60, -57, -57, -57, -60, -69, -66, -66, -66, -66, -72, -69, -66, -69, -66, -69,
    -69, -66, -66, -66, -66, -63, -69, -66, -66, -69, -69, -72, -69, -57, -48, -48,
    -60, -63, -63, -54, -30, -27, -21, -18, -24, -27, -39, -42, -39, -24, -24, -27,
    -33, -45, -51, -33, -33, -36, -42, -39, -39, -45, -51, -57, -63, -66, -66, -63,
    -69, -63, -66, -66, -63, -69, -69, -66, -69, -66, -69, -66, -69, -66, -66, -66,
    -69, -69, -69, -69, -69, -45, -27, -24, -27, -30, -30, -36, -36, -18, -18, -18,
    -15, -21, -24, -24, -30, -48, -57, -33, -24, -18, -21, -21, -18, -21, -24, -27,
    -18, -18, -18, -21, -27, -21, -18, -18, -18, -21, -18, -18, -21, -27, -30, -30,
    -45, -24, -21, -24, -33, -27, -21, -21, -21, -27, -30, -33, -42, -57, -57, -60,
    -57, -57, -57, -60, -57, -54, -51, -54, -54, -57, -54, -57, -57, -54, -57, -54,
    -54, -57, -51, -48, -48, -57, -57, -57, -57, -57, -57, -57, -57, -54, -51, -48,
    -39, -42, -42, -42, -39, -45, -51, -51, -51, -54, -51, -48, -45, -54, -57, -51,
    -48, -54, -60, -57, -54, -54, -51, -51, -51, -51, -54, -54, -57, -54, -51, -54,
    -54, -57, -51, -51,
  ];
  const frameLevelsDbfs = blockLevelsDbfs.flatMap((level) => [level, level]);
  frameLevelsDbfs[0] = -240;
  const samples = new Float32Array(frameLevelsDbfs.length * frameSize);

  for (let frame = 0; frame < frameLevelsDbfs.length; frame += 1) {
    const amplitude = (10 ** (frameLevelsDbfs[frame] / 20)) * Math.SQRT2;
    for (let index = 0; index < frameSize; index += 1) {
      samples[frame * frameSize + index] =
        amplitude * Math.sin((2 * Math.PI * 180 * index) / sampleRate);
    }
  }
  return samples;
}
