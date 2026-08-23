import type { ChapterFile, Pickup } from "../project/types";

export const LIVE_CAUGHT_NOTE = "Caught while reading";
export const MIN_LIVE_TAPE_SECONDS = 0.3;
export const MAX_LIVE_TAPE_SECONDS = 2 * 60 * 60;

export interface LiveTapeChapter {
  audio_path?: string;
  raw_audio_path?: string;
  live_audio_path?: string;
}

export interface PickupAudioSource {
  relativePath: string;
  start: number;
  end: number;
  kind: "live" | "take";
  /** True when the range is the flagged word alone, with no line recorded. */
  wordOnly?: boolean;
}

/**
 * Widen a pickup to the line it belongs to.
 *
 * A word's timestamps come from a speech model's word alignment, which is
 * accurate to a few hundred milliseconds — most of a word, so a word-sized clip
 * regularly plays the neighbour instead of the flagged word. The line recorded
 * with the pickup is the range the narrator can actually judge, and hearing it
 * is also the only way to tell a real slip from the model mishearing a clean
 * read. Pickups filed before lines were recorded keep the word range.
 */
export function pickupLineBounds(
  pickup: Pick<Pickup, "t_start" | "t_end" | "line_start" | "line_end">,
): { start: number; end: number; wordOnly: boolean } {
  const lineStart = pickup.line_start;
  const lineEnd = pickup.line_end;
  if (Number.isFinite(lineStart) && Number.isFinite(lineEnd) && (lineEnd as number) > (lineStart as number)) {
    return { start: Math.max(0, lineStart as number), end: lineEnd as number, wordOnly: false };
  }
  return { start: Math.max(0, pickup.t_start), end: Math.max(0, pickup.t_end), wordOnly: true };
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
  pickup: Pick<Pickup, "id" | "note" | "t_start" | "t_end" | "line_start" | "line_end">,
  chapter: LiveTapeChapter,
): PickupAudioSource | null {
  const range = pickupLineBounds(pickup);
  if (isLiveCaughtPickup(pickup)) {
    if (!chapter.live_audio_path) {
      return null;
    }
    return {
      relativePath: chapter.live_audio_path,
      start: range.start,
      end: range.end,
      kind: "live",
      wordOnly: range.wordOnly,
    };
  }
  if (chapter.audio_path) {
    return {
      relativePath: chapter.audio_path,
      start: range.start,
      end: range.end,
      kind: "take",
      wordOnly: range.wordOnly,
    };
  }
  // Check chapter can run against the booth tape. Those flags are timed on
  // that file, so Listen has to play it — waiting for a later take would
  // mute every Review card after Start narrating.
  if (chapter.live_audio_path) {
    return {
      relativePath: chapter.live_audio_path,
      start: range.start,
      end: range.end,
      kind: "live",
      wordOnly: range.wordOnly,
    };
  }
  return null;
}

export function listenDisabledReason(
  pickup: Pick<Pickup, "id" | "note" | "t_start" | "t_end" | "line_start" | "line_end">,
  chapter: LiveTapeChapter,
): string | null {
  if (audioSourceForPickup(pickup, chapter)) {
    return null;
  }
  return isLiveCaughtPickup(pickup)
    ? "No booth tape of this read"
    : "No chapter take attached";
}

/**
 * Why this pickup cannot be punched yet, if it cannot.
 *
 * A live flag is timed on the booth tape, but a punch is spliced into the
 * chapter take — two different recordings of the same words, so the flag's
 * seconds point somewhere else entirely in the file being edited. Check chapter
 * re-files these against the take, which is what gives them a position a splice
 * can use.
 */
export function punchDisabledReason(
  pickup: Pick<Pickup, "id" | "note">,
  chapter: LiveTapeChapter,
): string | null {
  if (isLiveCaughtPickup(pickup)) {
    return chapter.audio_path
      ? "Run Check chapter first, so this flag is timed on the take"
      : "Attach the chapter take, then run Check chapter";
  }
  if (chapter.audio_path || chapter.live_audio_path) {
    return null;
  }
  return "No chapter take attached";
}

/**
 * A punch splices the chapter take. After a booth read there often is no
 * take yet — only the tape Check chapter already timed against. Point the
 * take at that same file so the splice uses the clock the flags already have.
 */
export function chapterWithBoothTapeAsTake<T extends LiveTapeChapter>(chapter: T): T {
  if (chapter.audio_path || !chapter.live_audio_path) {
    return chapter;
  }
  return {
    ...chapter,
    audio_path: chapter.live_audio_path,
    raw_audio_path: chapter.raw_audio_path ?? chapter.live_audio_path,
  };
}

/** Check chapter prefers the master take. The booth tape is enough when there is no take. */
export function proofAudioSource(chapter: LiveTapeChapter): PickupAudioSource | null {
  if (chapter.audio_path) {
    return {
      relativePath: chapter.audio_path,
      start: 0,
      end: 0,
      kind: "take",
    };
  }
  if (chapter.live_audio_path) {
    return {
      relativePath: chapter.live_audio_path,
      start: 0,
      end: 0,
      kind: "live",
    };
  }
  return null;
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
