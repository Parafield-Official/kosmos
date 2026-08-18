import { tokenizeManuscript } from "../proof/normalize";
import type { TranscriptWord } from "../proof/align";
import type { ScriptSpan, Seat } from "../project/types";
import type { DuetSegment } from "./mix";

/** Estimate seat timing from the saved word alignment without changing the ASR result. */
export function buildDuetTimeline(
  spans: ScriptSpan[],
  transcript: TranscriptWord[],
  durationSeconds: number,
): DuetSegment[] {
  const text = spans.map((span) => span.text).join("");
  const tokens = tokenizeManuscript(text);
  if (tokens.length === 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [];
  }

  // Whisper can emit valid words without usable timestamps. Zero-duration
  // entries must not create zero-length mix segments; fall back to the same
  // deterministic proportional timeline used when alignment is absent.
  const timed = transcript.filter((word) =>
    Number.isFinite(word.start)
    && Number.isFinite(word.end)
    && word.start >= 0
    && word.end > word.start,
  );
  const tokenTimes = tokens.map((_token, index) => {
    if (timed.length === 0) {
      const start = durationSeconds * index / tokens.length;
      const end = durationSeconds * (index + 1) / tokens.length;
      return { start, end };
    }
    const fromIndex = Math.min(timed.length - 1, Math.floor(index * timed.length / tokens.length));
    const toIndex = Math.min(timed.length - 1, Math.max(fromIndex, Math.ceil((index + 1) * timed.length / tokens.length) - 1));
    return {
      start: clamp(timed[fromIndex].start, 0, durationSeconds),
      end: clamp(Math.max(timed[toIndex].end, timed[fromIndex].start), 0, durationSeconds),
    };
  });

  const segments: DuetSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    const spanStart = cursor;
    cursor += span.text.length;
    const spanEnd = cursor;
    const indices = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => token.start < spanEnd && token.end > spanStart)
      .map(({ index }) => index);
    if (indices.length === 0) {
      continue;
    }
    const start = tokenTimes[indices[0]].start;
    const end = tokenTimes[indices.at(-1)!].end;
    appendSegment(segments, { start, end: Math.max(start, end), seat: span.seat });
  }
  return segments;
}

function appendSegment(segments: DuetSegment[], next: DuetSegment): void {
  const previous = segments.at(-1);
  if (previous && previous.seat === next.seat && next.start <= previous.end + 0.05) {
    previous.end = Math.max(previous.end, next.end);
  } else {
    segments.push(next);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type { Seat };
