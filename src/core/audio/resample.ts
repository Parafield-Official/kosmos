/** Resample an already-mono PCM signal with a bounded linear interpolator. */
export function resamplePcmToMono(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (samples.length === 0) {
    return new Float32Array(0);
  }
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
    return new Float32Array(samples);
  }
  const outputLength = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[Math.min(samples.length - 1, left)] ?? 0;
    const b = samples[Math.min(samples.length - 1, left + 1)] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}
