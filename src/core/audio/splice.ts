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
  if (options.crossfadeMs !== undefined && (!Number.isFinite(options.crossfadeMs) || options.crossfadeMs < 0)) {
    throw new Error("Punch crossfade must be a finite non-negative number");
  }

  const original = options.original;
  const replacement = options.replacement;
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

  const prefixLength = start;
  const suffixStart = end;
  const suffixLength = original.length - suffixStart;
  const output = new Float32Array(
    original.length - (end - start) + replacement.length - (crossfade * 2),
  );
  let outputIndex = 0;

  // Copy in a loop rather than spreading a chapter-sized array into a
  // function call. Long audiobook takes can contain hundreds of millions of
  // samples, which otherwise exceeds JavaScript's argument limit.
  const prefixBodyEnd = Math.max(0, prefixLength - crossfade);
  for (let index = 0; index < prefixBodyEnd; index += 1) {
    output[outputIndex] = original[index];
    outputIndex += 1;
  }

  if (crossfade > 0) {
    const prefixStart = prefixLength - crossfade;
    for (let index = 0; index < crossfade; index += 1) {
      const amount = (index + 1) / (crossfade + 1);
      output[outputIndex] = original[prefixStart + index] * (1 - amount) + replacement[index] * amount;
      outputIndex += 1;
    }
  }

  const replacementStart = crossfade;
  const replacementEnd = Math.max(replacementStart, replacement.length - crossfade);
  for (let index = replacementStart; index < replacementEnd; index += 1) {
    output[outputIndex] = replacement[index];
    outputIndex += 1;
  }

  if (crossfade > 0) {
    const replacementStartAtEnd = replacement.length - crossfade;
    for (let index = 0; index < crossfade; index += 1) {
      const amount = (index + 1) / (crossfade + 1);
      output[outputIndex] = replacement[replacementStartAtEnd + index] * (1 - amount)
        + original[suffixStart + index] * amount;
      outputIndex += 1;
    }
  }

  for (let index = crossfade; index < suffixLength; index += 1) {
    output[outputIndex] = original[suffixStart + index];
    outputIndex += 1;
  }
  return output;
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
