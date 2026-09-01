import { describe, expect, it } from "vitest";
import { findSilences } from "./silence";

const SAMPLE_RATE = 8000;

/**
 * A stand-in for narration: speech-shaped energy over a quiet room, with the
 * room left bare wherever the script says to stop talking.
 */
function recording(
  segments: readonly { seconds: number; speech: boolean }[],
  options: { roomToneDbfs?: number; speechDbfs?: number } = {},
): Float32Array {
  const roomTone = 10 ** ((options.roomToneDbfs ?? -60) / 20);
  const speechLevel = 10 ** ((options.speechDbfs ?? -20) / 20);
  const total = segments.reduce((sum, part) => sum + Math.round(part.seconds * SAMPLE_RATE), 0);
  const samples = new Float32Array(total);
  let cursor = 0;
  let phase = 0;
  for (const part of segments) {
    const frames = Math.round(part.seconds * SAMPLE_RATE);
    for (let index = 0; index < frames; index += 1) {
      // A deterministic wobble stands in for room noise so the tenth
      // percentile has something to find.
      const noise = roomTone * Math.sin(index * 0.37) * 0.9;
      if (part.speech) {
        phase += (2 * Math.PI * 180) / SAMPLE_RATE;
        const envelope = 0.6 + 0.4 * Math.sin((index / SAMPLE_RATE) * 6);
        samples[cursor + index] = speechLevel * envelope * Math.sin(phase) + noise;
      } else {
        samples[cursor + index] = noise;
      }
    }
    cursor += frames;
  }
  return samples;
}

describe("findSilences", () => {
  it("finds a long pause between two spoken stretches", () => {
    const samples = recording([
      { seconds: 2, speech: true },
      { seconds: 5, speech: false },
      { seconds: 2, speech: true },
    ]);
    const found = findSilences(samples, SAMPLE_RATE, 1, { minSeconds: 1 });
    expect(found).toHaveLength(1);
    expect(found[0].start).toBeCloseTo(2, 1);
    expect(found[0].end).toBeCloseTo(7, 1);
  });

  it("ignores gaps shorter than the caller cares about", () => {
    const samples = recording([
      { seconds: 1, speech: true },
      { seconds: 0.3, speech: false },
      { seconds: 1, speech: true },
      { seconds: 2, speech: false },
      { seconds: 1, speech: true },
    ]);
    const found = findSilences(samples, SAMPLE_RATE, 1, { minSeconds: 1 });
    expect(found).toHaveLength(1);
    expect(found[0].end - found[0].start).toBeGreaterThan(1.5);
  });

  it("reports several pauses in reading order", () => {
    const samples = recording([
      { seconds: 1, speech: true },
      { seconds: 2, speech: false },
      { seconds: 1, speech: true },
      { seconds: 3, speech: false },
      { seconds: 1, speech: true },
    ]);
    const found = findSilences(samples, SAMPLE_RATE, 1, { minSeconds: 1 });
    expect(found).toHaveLength(2);
    expect(found[0].start).toBeLessThan(found[1].start);
    expect(found[1].end - found[1].start).toBeGreaterThan(found[0].end - found[0].start);
  });

  it("still separates speech from a noisy room", () => {
    const samples = recording(
      [
        { seconds: 2, speech: true },
        { seconds: 4, speech: false },
        { seconds: 2, speech: true },
      ],
      { roomToneDbfs: -42, speechDbfs: -18 },
    );
    const found = findSilences(samples, SAMPLE_RATE, 1, { minSeconds: 1 });
    expect(found).toHaveLength(1);
    expect(found[0].start).toBeCloseTo(2, 0);
  });

  it("finds nothing in continuous narration", () => {
    const samples = recording([{ seconds: 6, speech: true }]);
    expect(findSilences(samples, SAMPLE_RATE, 1, { minSeconds: 1 })).toEqual([]);
  });

  it("reads a silence that runs to the end of the file", () => {
    const samples = recording([
      { seconds: 2, speech: true },
      { seconds: 4, speech: false },
    ]);
    const found = findSilences(samples, SAMPLE_RATE, 1, { minSeconds: 1 });
    expect(found).toHaveLength(1);
    expect(found[0].end).toBeCloseTo(6, 1);
  });

  it("handles interleaved stereo without smearing the timings", () => {
    const mono = recording([
      { seconds: 1, speech: true },
      { seconds: 3, speech: false },
      { seconds: 1, speech: true },
    ]);
    const stereo = new Float32Array(mono.length * 2);
    for (let index = 0; index < mono.length; index += 1) {
      stereo[index * 2] = mono[index];
      stereo[index * 2 + 1] = mono[index];
    }
    const found = findSilences(stereo, SAMPLE_RATE, 2, { minSeconds: 1 });
    expect(found).toHaveLength(1);
    expect(found[0].start).toBeCloseTo(1, 1);
    expect(found[0].end).toBeCloseTo(4, 1);
  });

  it("returns nothing for empty or nonsense input", () => {
    expect(findSilences(new Float32Array(0), SAMPLE_RATE)).toEqual([]);
    expect(findSilences(new Float32Array(16), 0)).toEqual([]);
    expect(findSilences(new Float32Array(4), SAMPLE_RATE)).toEqual([]);
  });

  it("treats a digitally silent file as one long pause", () => {
    const found = findSilences(new Float32Array(SAMPLE_RATE * 5), SAMPLE_RATE, 1, { minSeconds: 1 });
    expect(found).toHaveLength(1);
    expect(found[0].start).toBeCloseTo(0, 2);
    expect(found[0].end).toBeCloseTo(5, 1);
  });
});
