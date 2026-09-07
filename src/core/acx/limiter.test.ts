import { describe, expect, it } from "vitest";
import { limitTruePeak } from "./limiter";
import { rmsDbfs, truePeakDbfs } from "./measure";

describe("lookahead peak limiter", () => {
  const rate = 44_100;

  it("leaves audio below the ceiling untouched", () => {
    const samples = Array.from({ length: rate }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 220 * i / rate));
    expect(limitTruePeak(samples, rate, -3.2)).toBe(samples);
  });

  it("contains peaks at both boundaries without changing duration or sample positions", () => {
    const samples = Array<number>(rate).fill(0);
    samples[0] = 2;
    samples[rate - 1] = -2;
    const output = limitTruePeak(samples, rate, -3.2);
    expect(output).toHaveLength(samples.length);
    expect(output[0]).toBeGreaterThan(0);
    expect(output[rate - 1]).toBeLessThan(0);
    expect(output.slice(1, -1).every(x => x === 0)).toBe(true);
    expect(truePeakDbfs(output, 1)).toBeLessThanOrEqual(-3.2 + 1e-8);
  });

  it("recovers narration level after a transient instead of scaling down the whole file", () => {
    const samples = Array.from({ length: rate * 3 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 220 * i / rate));
    samples[rate] = 3;
    const output = limitTruePeak(samples, rate, -3.2);
    expect(truePeakDbfs(output, 1)).toBeLessThanOrEqual(-3.2 + 1e-8);
    const from = rate * 2;
    expect(rmsDbfs(output.slice(from)) - rmsDbfs(samples.slice(from))).toBeGreaterThan(-0.1);
  });

  for (const frequency of [100, 1000]) {
    it(`does not waveshape a sustained ${frequency} Hz tone while limiting`, () => {
      const samples = Array.from({ length: rate * 2 }, (_, i) => 2 * Math.sin(2 * Math.PI * frequency * i / rate));
      const output = limitTruePeak(samples, rate, -3.2);
      const body = output.slice(rate, rate * 2);
      const amplitude = (hz: number) => {
        let real = 0, imaginary = 0;
        for (let i = 0; i < body.length; i++) {
          real += body[i] * Math.cos(2 * Math.PI * hz * i / rate);
          imaginary += body[i] * Math.sin(2 * Math.PI * hz * i / rate);
        }
        return Math.hypot(real, imaginary);
      };
      const distortion = Math.hypot(...[3, 5, 7].map(n => amplitude(frequency * n))) / amplitude(frequency);
      expect(20 * Math.log10(distortion)).toBeLessThan(-60);
      expect(truePeakDbfs(output, 1)).toBeLessThanOrEqual(-3.2 + 1e-8);
    });
  }
});
