import { describe, expect, it } from "vitest";
import { integratedLufs } from "./loudness";

/**
 * EBU Tech 3341 states its minimum-requirement signals as a 1 kHz sine applied
 * in phase to both channels at a given per-channel *peak* level, lasting 20 s.
 */
function stereoSine(peakDbfs: number, seconds: number, sampleRate: number): Float32Array {
  const frames = Math.round(seconds * sampleRate);
  const amplitude = Math.pow(10, peakDbfs / 20);
  const samples = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = amplitude * Math.sin((2 * Math.PI * 1000 * frame) / sampleRate);
    samples[frame * 2] = value;
    samples[frame * 2 + 1] = value;
  }
  return samples;
}

/** EBU Tech 3341 specifies a tolerance of ±0.1 LUFS on its test signals. */
function expectCompliant(measured: number, expected: number): void {
  expect(Math.abs(measured - expected)).toBeLessThanOrEqual(0.1);
}

function concatStereo(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("integrated loudness (ITU-R BS.1770 / EBU Tech 3341)", () => {
  it("reads -23.0 LUFS for compliance signal 1 at 48 kHz", () => {
    expectCompliant(integratedLufs(stereoSine(-23, 20, 48_000), 48_000, 2), -23);
  });

  it("reads -23.0 LUFS for compliance signal 1 at 44.1 kHz", () => {
    expectCompliant(integratedLufs(stereoSine(-23, 20, 44_100), 44_100, 2), -23);
  });

  it("reads -33.0 LUFS for compliance signal 2", () => {
    expectCompliant(integratedLufs(stereoSine(-33, 20, 48_000), 48_000, 2), -33);
  });

  it("gates out quiet surroundings below the relative threshold (signal 3)", () => {
    const signal = concatStereo(
      stereoSine(-40, 20, 48_000),
      stereoSine(-23, 20, 48_000),
      stereoSine(-40, 20, 48_000),
    );
    expectCompliant(integratedLufs(signal, 48_000, 2), -23);
  });

  it("gates out surroundings below the absolute threshold (signal 4)", () => {
    const signal = concatStereo(
      stereoSine(-75, 20, 48_000),
      stereoSine(-23, 20, 48_000),
      stereoSine(-75, 20, 48_000),
    );
    expectCompliant(integratedLufs(signal, 48_000, 2), -23);
  });

  it("tracks gain changes one for one", () => {
    const quiet = integratedLufs(stereoSine(-33, 5, 48_000), 48_000, 2);
    const loud = integratedLufs(stereoSine(-23, 5, 48_000), 48_000, 2);
    expect(loud - quiet).toBeCloseTo(10, 2);
  });

  it("reports mono at 3 LU below the same tone summed across two channels", () => {
    const stereo = stereoSine(-23, 5, 48_000);
    const mono = new Float32Array(stereo.length / 2);
    for (let frame = 0; frame < mono.length; frame += 1) {
      mono[frame] = stereo[frame * 2];
    }
    const difference = integratedLufs(stereo, 48_000, 2) - integratedLufs(mono, 48_000, 1);
    expect(difference).toBeCloseTo(3.01, 1);
  });

  it("returns -Infinity for digital silence and for clips shorter than one block", () => {
    expect(integratedLufs(new Float32Array(48_000), 48_000, 1)).toBe(-Infinity);
    expect(integratedLufs(stereoSine(-23, 0.2, 48_000), 48_000, 2)).toBe(-Infinity);
  });
});
