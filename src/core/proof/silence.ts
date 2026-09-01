export interface SilenceRange {
  start: number;
  end: number;
}

export interface SilenceOptions {
  /** Shortest gap worth reporting. */
  minSeconds?: number;
  /**
   * How far above the room's own noise floor still counts as silence. Narration
   * sits 30 dB or more above room tone, so a generous margin still separates
   * speech from a quiet room.
   */
  marginDb?: number;
  /** Nothing quieter than this is ever treated as speech. */
  floorCeilingDbfs?: number;
}

const FRAME_SECONDS = 0.02;
const DEFAULT_MIN_SECONDS = 0.4;
const DEFAULT_MARGIN_DB = 12;
const DEFAULT_FLOOR_CEILING = -45;

/**
 * Find the quiet stretches in a recording.
 *
 * Pause detection cannot be built on transcript timings: whisper.cpp spreads a
 * segment's words evenly across its span, so five seconds of silence in the
 * middle of a sentence can come back as a half-second gap. The audio itself is
 * the only honest source for where the narrator stopped talking.
 *
 * The threshold is measured from this recording rather than fixed, so a noisy
 * room does not read as continuous speech.
 */
export function findSilences(
  samples: Float32Array | number[],
  sampleRate: number,
  channels = 1,
  options: SilenceOptions = {},
): SilenceRange[] {
  const channelCount = Math.max(1, Math.floor(channels));
  const frameCount = Math.max(1, Math.round(FRAME_SECONDS * sampleRate));
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length < frameCount * channelCount) {
    return [];
  }
  const minSeconds = Math.max(0, options.minSeconds ?? DEFAULT_MIN_SECONDS);
  const frames = Math.floor(samples.length / channelCount / frameCount);
  const levels = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    const from = frame * frameCount * channelCount;
    const to = from + frameCount * channelCount;
    for (let index = from; index < to; index += 1) {
      const value = samples[index];
      sum += value * value;
    }
    levels[frame] = Math.sqrt(sum / (frameCount * channelCount));
  }

  const threshold = silenceThreshold(levels, options);
  const ranges: SilenceRange[] = [];
  let runStart: number | null = null;
  for (let frame = 0; frame <= frames; frame += 1) {
    const quiet = frame < frames && levels[frame] <= threshold;
    if (quiet && runStart === null) {
      runStart = frame;
      continue;
    }
    if (!quiet && runStart !== null) {
      const start = (runStart * frameCount) / sampleRate;
      const end = (frame * frameCount) / sampleRate;
      if (end - start >= minSeconds) {
        ranges.push({ start, end });
      }
      runStart = null;
    }
  }
  return ranges;
}

/**
 * A level between this recording's quiet frames and its speech. The tenth
 * percentile stands in for room tone, which is robust to a recording that opens
 * with a held breath or ends mid-word.
 */
function silenceThreshold(levels: Float64Array, options: SilenceOptions): number {
  const sorted = Float64Array.from(levels).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const margin = 10 ** ((options.marginDb ?? DEFAULT_MARGIN_DB) / 20);
  const ceiling = 10 ** ((options.floorCeilingDbfs ?? DEFAULT_FLOOR_CEILING) / 20);
  return Math.min(ceiling, Math.max(floor * margin, 1e-6));
}
