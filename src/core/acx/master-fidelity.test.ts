import { describe, expect, it } from "vitest";
import { masterPcm } from "./master";

describe("mastering waveform fidelity", () => {
  for (const frequency of [100, 1000]) {
    it(`does not add audible odd harmonics to a ${frequency} Hz voiced tone`, () => {
      const rate = 44100;
      const samples = new Float32Array(rate * 5);
      for (let i = rate; i < rate * 4; i++) {
        samples[i] = 0.35 * Math.sin(2 * Math.PI * frequency * i / rate);
      }
      const result = masterPcm({ samples, sampleRate: rate, channels: 1 });
      expect(result.status).toBe("ok");
      // Measure settled speech, away from the gate and pad boundaries.
      const body = result.samples.slice(rate * 2, rate * 3);
      const amplitude = (hz: number) => {
        let real = 0, imag = 0;
        for (let i = 0; i < body.length; i++) {
          real += body[i] * Math.cos(2 * Math.PI * hz * i / rate);
          imag += body[i] * Math.sin(2 * Math.PI * hz * i / rate);
        }
        return Math.hypot(real, imag);
      };
      const fundamental = amplitude(frequency);
      const distortion = Math.hypot(...[3, 5, 7].map(n => amplitude(frequency * n))) / fundamental;
      expect(20 * Math.log10(distortion)).toBeLessThan(-60);
      expect(result.after?.checks.rms).toBe("pass");
      expect(result.after?.checks.true_peak).toBe("pass");
    });
  }
});

it('preserves non-silent quiet boundary content instead of trimming by speech threshold', () => {
  const rate = 44100;
  const samples = Float32Array.from({ length: rate * 5 }, (_, i) => {
    const t = i / rate;
    const amplitude = (t >= 1 && t < 1.2) || (t >= 3 && t < 3.2) ? 0.0014 : t >= 1.2 && t < 3 ? 0.14 : 0.0007;
    const hz = amplitude === 0.14 ? 200 : amplitude === 0.0014 ? 1000 : 4000;
    return amplitude * Math.sin(2 * Math.PI * hz * t);
  });
  const result = masterPcm({ samples, sampleRate: rate, channels: 1 });
  expect(result.status).toBe('ok');
  // Original five seconds must remain between the added 1.5-second pads.
  expect(result.samples.length).toBeGreaterThanOrEqual(samples.length + rate * 3 - 2);
});
