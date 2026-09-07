import { truePeakDbfs } from "./measure";

/**
 * Offline peak control: hold gain across waveform cycles, release gradually,
 * and anticipate attenuation with a backwards attack ramp. No samples move or
 * get clipped. The final oversampled check reserves the requested true peak.
 */
export function limitTruePeak(samples: number[], sampleRate: number, ceilingDbfs: number): number[] {
  if (truePeakDbfs(samples, 1) <= ceilingDbfs) return samples;

  const ceiling = 10 ** (ceilingDbfs / 20);
  const attackSamples = Math.max(1, Math.round(sampleRate * 0.005));
  const holdSamples = Math.max(1, Math.round(sampleRate * 0.01));
  const releaseCoefficient = Math.exp(-1 / (sampleRate * 0.08));
  const gains = new Float64Array(samples.length);
  const peaks = new Int32Array(holdSamples + 1);
  let head = 0;
  let tail = 0;
  let gain = 1;
  for (let index = 0; index < samples.length; index += 1) {
    // Sliding maximum holds successive waveform peaks even when their floating
    // point magnitudes differ slightly; resetting a timer only at a new maximum
    // lets the release modulate a sustained tone and creates harmonics.
    while (head !== tail && peaks[head] <= index - holdSamples) head = (head + 1) % peaks.length;
    while (head !== tail) {
      const previous = (tail + peaks.length - 1) % peaks.length;
      if (Math.abs(samples[peaks[previous]]) > Math.abs(samples[index])) break;
      tail = previous;
    }
    peaks[tail] = index;
    tail = (tail + 1) % peaks.length;
    const required = Math.min(1, ceiling / Math.max(Math.abs(samples[peaks[head]]), 1e-20));
    gain = Math.min(required, 1 - (1 - gain) * releaseCoefficient);
    gains[index] = gain;
  }
  // Bound the gain slope before each peak, including peaks at either edge.
  // A backwards pass provides lookahead without shifting narration timing.
  for (let index = gains.length - 2; index >= 0; index -= 1) {
    gains[index] = Math.min(gains[index], gains[index + 1] + 1 / attackSamples);
  }
  let output = samples.map((sample, index) => sample * gains[index]);
  // Inter-sample reconstruction can exceed the sample ceiling. Apply only the
  // residual true-peak correction after local dynamics have reduced the peaks.
  for (let pass = 0; pass < 2; pass += 1) {
    const peak = truePeakDbfs(output, 1);
    if (peak <= ceilingDbfs) break;
    const correction = 10 ** ((ceilingDbfs - peak) / 20);
    output = output.map(sample => sample * correction);
  }
  return output;
}
