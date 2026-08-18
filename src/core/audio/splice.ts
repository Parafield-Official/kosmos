export interface PunchSpliceOptions {
  original: Float32Array | number[];
  replacement: Float32Array | number[];
  sampleRate: number;
  startSeconds: number;
  endSeconds: number;
  crossfadeMs?: number;
}

/** Replace a time range without mutating the original take. */
export function splicePunch(options: PunchSpliceOptions): Float32Array {
  if (!Number.isInteger(options.sampleRate) || options.sampleRate <= 0) {
    throw new Error("Punch sample rate must be a positive integer");
  }
  if (!Number.isFinite(options.startSeconds) || !Number.isFinite(options.endSeconds)) {
    throw new Error("Punch boundaries must be finite");
  }
  if (options.endSeconds <= options.startSeconds) {
    throw new Error("Punch end must be after punch start");
  }

  const original = Array.from(options.original);
  const replacement = Array.from(options.replacement);
  if (replacement.length === 0) {
    throw new Error("Punch replacement cannot be empty");
  }
  const start = clamp(Math.round(options.startSeconds * options.sampleRate), 0, original.length);
  const end = clamp(Math.round(options.endSeconds * options.sampleRate), start, original.length);
  const crossfade = clamp(
    Math.round((options.crossfadeMs ?? 10) * options.sampleRate / 1000),
    0,
    Math.floor(Math.min(start, original.length - end, replacement.length) / 2),
  );

  const prefix = original.slice(0, start);
  const suffix = original.slice(end);
  const output: number[] = [];
  output.push(...prefix.slice(0, Math.max(0, prefix.length - crossfade)));

  if (crossfade > 0) {
    const prefixStart = prefix.length - crossfade;
    for (let index = 0; index < crossfade; index += 1) {
      const amount = (index + 1) / (crossfade + 1);
      output.push(prefix[prefixStart + index] * (1 - amount) + replacement[index] * amount);
    }
  }

  const replacementStart = crossfade;
  const replacementEnd = Math.max(replacementStart, replacement.length - crossfade);
  output.push(...replacement.slice(replacementStart, replacementEnd));

  if (crossfade > 0) {
    const replacementStartAtEnd = replacement.length - crossfade;
    for (let index = 0; index < crossfade; index += 1) {
      const amount = (index + 1) / (crossfade + 1);
      output.push(replacement[replacementStartAtEnd + index] * (1 - amount) + suffix[index] * amount);
    }
  }

  output.push(...suffix.slice(crossfade));
  return Float32Array.from(output);
}

/** Remove quiet leading/trailing samples while retaining a small speech pad. */
export function trimPunchSilence(
  samples: Float32Array | number[],
  sampleRate: number,
  options: { threshold?: number; padMs?: number } = {},
): Float32Array {
  const values = Array.from(samples);
  if (values.length === 0) {
    return new Float32Array();
  }
  const threshold = Math.max(0, options.threshold ?? 0.01);
  const pad = Math.max(0, Math.round((options.padMs ?? 50) * sampleRate / 1000));
  let first = values.findIndex((value) => Math.abs(value) >= threshold);
  if (first < 0) {
    return new Float32Array(values);
  }
  let last = values.length - 1;
  while (last >= first && Math.abs(values[last]) < threshold) {
    last -= 1;
  }
  first = Math.max(0, first - pad);
  last = Math.min(values.length - 1, last + pad);
  return Float32Array.from(values.slice(first, last + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
