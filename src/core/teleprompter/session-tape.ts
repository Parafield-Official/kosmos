import type { ChapterFile, Pickup } from "../project/types";

export const LIVE_CAUGHT_NOTE = "Caught while reading";
export const MIN_LIVE_TAPE_SECONDS = 0.3;
export const MAX_LIVE_TAPE_SECONDS = 2 * 60 * 60;

export interface LiveTapeChapter {
  audio_path?: string;
  live_audio_path?: string;
}

export interface PickupAudioSource {
  relativePath: string;
  start: number;
  end: number;
  kind: "live" | "take";
}

/** True when Review filed this row from Start narrating, not from Check chapter. */
export function isLiveCaughtPickup(pickup: Pick<Pickup, "id" | "note">): boolean {
  return pickup.note === LIVE_CAUGHT_NOTE || pickup.id.startsWith("live-");
}

/**
 * Listen must use the clock that created the flag. A live flag's time is the
 * booth tape. A proof flag's time is the attached take. The other file is the
 * wrong recording even when both exist.
 */
export function audioSourceForPickup(
  pickup: Pick<Pickup, "id" | "note" | "t_start" | "t_end">,
  chapter: LiveTapeChapter,
): PickupAudioSource | null {
  if (isLiveCaughtPickup(pickup)) {
    if (!chapter.live_audio_path) {
      return null;
    }
    return {
      relativePath: chapter.live_audio_path,
      start: pickup.t_start,
      end: pickup.t_end,
      kind: "live",
    };
  }
  if (!chapter.audio_path) {
    return null;
  }
  return {
    relativePath: chapter.audio_path,
    start: pickup.t_start,
    end: pickup.t_end,
    kind: "take",
  };
}

export function listenDisabledReason(
  pickup: Pick<Pickup, "id" | "note" | "t_start" | "t_end">,
  chapter: LiveTapeChapter,
): string | null {
  if (audioSourceForPickup(pickup, chapter)) {
    return null;
  }
  return isLiveCaughtPickup(pickup)
    ? "No booth tape of this read"
    : "No chapter take attached";
}

export function shouldKeepLiveTape(sampleCount: number, sampleRate: number): boolean {
  if (!Number.isFinite(sampleCount) || !Number.isFinite(sampleRate) || sampleRate <= 0 || sampleCount <= 0) {
    return false;
  }
  const seconds = sampleCount / sampleRate;
  return seconds >= MIN_LIVE_TAPE_SECONDS && seconds <= MAX_LIVE_TAPE_SECONDS;
}

export function concatLiveTape(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

export function liveTapePathHint(chapter: Pick<ChapterFile, "id">): string {
  return `audio/live/${chapter.id}_session.wav`;
}
