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
