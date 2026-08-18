import { describe, expect, it } from "vitest";
import { masterPcm } from "./master";

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
