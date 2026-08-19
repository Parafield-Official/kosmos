import { normalizeToken } from "../proof/normalize";
import type { Pickup, Seat } from "../project/types";

export interface LiveExpectedWord {
  index: number;
  lineIndex: number;
  text: string;
}

export interface LiveTranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface LiveHeardToken {
  text: string;
  end: number;
}

export interface LiveMatchState {
  cursor: number;
  lastHeardEnd: number;
  recentHeard?: LiveHeardToken[];
}

export interface LiveMismatch {
  id: string;
  expected: string;
  heard: string;
  expectedIndex: number;
  lineIndex: number;
  start: number;
  end: number;
  confidence: number;
}

export interface LiveMatchResult {
  state: LiveMatchState;
  flag?: LiveMismatch;
}

export interface LiveMatchInput {
  chapterId: string;
  expected: LiveExpectedWord[];
  transcript: LiveTranscriptWord[];
  state: LiveMatchState;
  flagsEnabled: boolean;
  confidenceThreshold?: number;
  dismissedIds?: string[];
}

export const LIVE_CONTEXT_SECONDS = 1.6;
export const LIVE_HOP_SECONDS = 0.55;
export const LIVE_MIN_SPEECH_SECONDS = 0.9;
export const LIVE_SPEECH_RMS = 0.01;
export const LIVE_OVERLAP_SECONDS = 1.05;
export const LIVE_UNSTABLE_TAIL_SECONDS = 0.32;

const LIVE_RESYNC_LOOKAHEAD = 8;
const RECENT_HEARD_LIMIT = 12;
const OVERLAP_REMATCH_SECONDS = 0.65;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

const NON_SPEECH_TOKENS = new Set([
  "blank",
  "audio",
  "blankaudio",
  "subtitle",
  "subtitles",
  "sub",
  "foreign",
  "applause",
  "subscribe",
  "laughter",
  "laughs",
  "inaudible",
  "silence",
  "credits",
  "caption",
  "captions",
]);

const HALLUCINATION_ONLY_TOKENS = new Set([
  ...NON_SPEECH_TOKENS,
  "music",
  "thank",
  "thanks",
  "bye",
  "goodbye",
  "please",
]);

/**
 * Consume a rolling ASR window without ever moving the prompt backwards.
 * Exact words and close mishears advance follow. A high-confidence real
 * mismatch still advances and flags, so a stumble does not pin the page.
 * Hallucinated silence tokens and overlapped copies are ignored.
 */
export function matchLiveWindow(input: LiveMatchInput): LiveMatchResult {
  let cursor = Math.max(0, Math.min(input.expected.length, Math.floor(input.state.cursor)));
  let lastHeardEnd = Number.isFinite(input.state.lastHeardEnd) ? Math.max(0, input.state.lastHeardEnd) : 0;
  const recentHeard = [...(input.state.recentHeard ?? [])];
  const threshold = Number.isFinite(input.confidenceThreshold)
    ? Math.min(1, Math.max(0, input.confidenceThreshold as number))
    : 0.9;
  const dismissedIds = new Set(input.dismissedIds ?? []);
  let flag: LiveMismatch | undefined;

  const words = usableLiveWords(input.transcript);

  for (const [wordIndex, word] of words.entries()) {
    const heard = normalizeToken(word.text);
    if (!heard) {
      continue;
    }
    if (word.end <= lastHeardEnd + 0.05) {
      continue;
    }
    if (isRecentHeardDuplicate(recentHeard, heard, word.end)) {
      lastHeardEnd = Math.max(lastHeardEnd, word.end);
      continue;
    }

    lastHeardEnd = Math.max(lastHeardEnd, word.end);
    rememberHeard(recentHeard, heard, word.end);

    const expectedWord = input.expected[cursor];
    if (!expectedWord) {
      continue;
    }
    const expected = normalizeToken(expectedWord.text);
    if (!expected) {
      continue;
    }
    if (heard === expected || wordsSimilar(heard, expected)) {
      cursor += 1;
      continue;
    }

    const nextHeard = normalizeToken(words[wordIndex + 1]?.text ?? "");
    const lookahead = input.expected.slice(cursor + 1, cursor + 1 + LIVE_RESYNC_LOOKAHEAD);
    if (nextHeard) {
      const resyncOffset = lookahead.findIndex((candidate, candidateOffset) => (
        normalizeToken(candidate.text) === heard
        && normalizeToken(lookahead[candidateOffset + 1]?.text ?? "") === nextHeard
      ));
      if (resyncOffset >= 0) {
        cursor += resyncOffset + 3;
        const confirmed = words[wordIndex + 1];
        if (confirmed) {
          lastHeardEnd = Math.max(lastHeardEnd, confirmed.end);
          rememberHeard(recentHeard, nextHeard, confirmed.end);
        }
        continue;
      }
    }

    if (lookahead.some((candidate) => normalizeToken(candidate.text) === heard)) {
      continue;
    }

    const confidence = Number.isFinite(word.confidence) ? Math.min(1, Math.max(0, word.confidence as number)) : 0;
    if (confidence < threshold || !isContentWord(heard) || !isContentWord(expected)) {
      continue;
    }

    const id = `live-${input.chapterId}-${expectedWord.index}-${heard}`;
    if (input.flagsEnabled && !flag && !dismissedIds.has(id)) {
      flag = {
        id,
        expected: expectedWord.text,
        heard: word.text,
        expectedIndex: expectedWord.index,
        lineIndex: expectedWord.lineIndex,
        start: Math.max(0, word.start),
        end: Math.max(Math.max(0, word.start), word.end),
        confidence,
      };
    }
    cursor += 1;
  }

  return {
    state: {
      cursor,
      lastHeardEnd,
      recentHeard: recentHeard.slice(-RECENT_HEARD_LIMIT),
    },
    flag,
  };
}

export function dropUnstableLiveTail(
  words: LiveTranscriptWord[],
  windowEndSeconds: number,
  tailSeconds = LIVE_UNSTABLE_TAIL_SECONDS,
): LiveTranscriptWord[] {
  if (!Number.isFinite(windowEndSeconds) || windowEndSeconds <= tailSeconds * 2) {
    return words;
  }
  const cutoff = windowEndSeconds - tailSeconds;
  return words.filter((word) => word.end <= cutoff);
}

export function pcmHasSpeech(samples: ArrayLike<number>, threshold = LIVE_SPEECH_RMS): boolean {
  const count = samples.length;
  if (count === 0) {
    return false;
  }
  let sumSquares = 0;
  for (let index = 0; index < count; index += 1) {
    const sample = samples[index] ?? 0;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / count) >= threshold;
}

export function liveVoiceStatusCopy(input: {
  status: "off" | "starting" | "listening" | "processing" | "error";
  enabled: boolean;
  dimmed: boolean;
  error: string | null;
  heardText: string;
}): { title: string; detail: string } {
  if (input.dimmed) {
    return { title: "Paused", detail: input.error ?? "" };
  }
  if (input.status === "error") {
    return { title: "Needs attention", detail: input.error ?? "" };
  }
  if (input.status === "starting") {
    return { title: "Starting", detail: "" };
  }
  if (!input.enabled) {
    return { title: "Off", detail: "" };
  }
  return {
    title: input.status === "processing" ? "Checking" : "Listening",
    detail: heardPreview(input.heardText),
  };
}

export function heardPreview(text: string): string {
  const tokens = String(text ?? "").match(WORD_PATTERN) ?? [];
  const kept = tokens.filter((token) => {
    const normalized = normalizeToken(token);
    return normalized.length > 0 && !NON_SPEECH_TOKENS.has(normalized);
  });
  if (
    kept.length === 0
    || looksLikeBlankAudio(kept.map((token) => normalizeToken(token)))
    || isHallucinationOnlyWindow(kept.map((token) => ({ text: token })))
  ) {
    return "";
  }
  return kept.slice(-2).join(" ");
}

export function liveWordMark(
  wordIndex: number,
  followIndex: number,
  flagIndex: number | null | undefined,
): { follow: boolean; flag: boolean } {
  return {
    follow: wordIndex === followIndex && followIndex >= 0,
    flag: flagIndex != null && flagIndex >= 0 && wordIndex === flagIndex,
  };
}

export function liveFlagChipCopy(flag: { expected: string; heard: string }): string {
  return `${flag.expected} → ${flag.heard}`;
}

/** Live flags file themselves. Dismiss is optional, not a gate. */
export function liveFlagRequiresClick(): boolean {
  return false;
}

export function pickupFromLiveFlag(
  flag: LiveMismatch,
  chapterId: string,
  seat: Seat = "narration",
): Pickup {
  const start = Math.max(0, flag.start);
  const end = Math.max(start, flag.end);
  return {
    id: flag.id,
    chapter_id: chapterId,
    t_start: start,
    t_end: end,
    expected: flag.expected,
    heard: flag.heard,
    kind: "sub",
    seat,
    status: "open",
    confidence: Number.isFinite(flag.confidence) ? Math.min(1, Math.max(0, flag.confidence)) : 0,
    note: "Caught while reading",
  };
}

export function mergeLivePickup(existing: Pickup[], pickup: Pickup): Pickup[] {
  if (existing.some((candidate) => candidate.id === pickup.id)) {
    return existing;
  }
  return [...existing, pickup].sort((left, right) => left.t_start - right.t_start);
}

function usableLiveWords(transcript: LiveTranscriptWord[]): LiveTranscriptWord[] {
  const words = transcript
    .filter((word) => typeof word.text === "string" && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start)
    .sort((left, right) => left.start - right.start)
    .filter((word) => {
      const heard = normalizeToken(word.text);
      return heard.length > 0 && !NON_SPEECH_TOKENS.has(heard);
    });
  return isHallucinationOnlyWindow(words) ? [] : words;
}

function isHallucinationOnlyWindow(words: Array<Pick<LiveTranscriptWord, "text">>): boolean {
  const tokens = words.map((word) => normalizeToken(word.text)).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return false;
  }
  if (looksLikeBlankAudio(tokens)) {
    return true;
  }
  return tokens.every((token) => HALLUCINATION_ONLY_TOKENS.has(token));
}

function looksLikeBlankAudio(tokens: string[]): boolean {
  return tokens.join("").includes("blankaudio");
}

function isRecentHeardDuplicate(recentHeard: LiveHeardToken[], heard: string, end: number): boolean {
  return recentHeard.some((item) => item.text === heard && Math.abs(item.end - end) <= OVERLAP_REMATCH_SECONDS);
}

function rememberHeard(recentHeard: LiveHeardToken[], text: string, end: number): void {
  recentHeard.push({ text, end });
  if (recentHeard.length > RECENT_HEARD_LIMIT) {
    recentHeard.splice(0, recentHeard.length - RECENT_HEARD_LIMIT);
  }
}

const FUNCTION_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "but", "by", "for", "from", "i",
  "in", "is", "it", "of", "on", "or", "the", "to", "we", "you",
]);

function isContentWord(token: string): boolean {
  return token.length >= 4 && !FUNCTION_WORDS.has(token);
}

function wordsSimilar(heard: string, expected: string): boolean {
  if (!heard || !expected || heard === expected) {
    return heard === expected && heard.length > 0;
  }
  const longer = Math.max(heard.length, expected.length);
  if (longer < 5) {
    return false;
  }
  const allowed = longer >= 8 ? 2 : 1;
  return editDistance(heard, expected) <= allowed;
}

function editDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row += 1) {
    grid[row]![0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    grid[0]![col] = col;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      grid[row]![col] = Math.min(
        (grid[row - 1]![col] ?? 0) + 1,
        (grid[row]![col - 1] ?? 0) + 1,
        (grid[row - 1]![col - 1] ?? 0) + cost,
      );
    }
  }
  return grid[left.length]![right.length] ?? Math.max(left.length, right.length);
}
