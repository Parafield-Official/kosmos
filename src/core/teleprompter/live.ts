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
  pendingResync?: { text: string; expectedIndex: number };
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
  flagShortWords?: boolean;
  requireFlagAnchor?: boolean;
  goldCursor?: number;
}

export const LIVE_CONTEXT_SECONDS = 1.6;
export const LIVE_HOP_SECONDS = 0.55;
export const LIVE_STREAM_HOP_SECONDS = 0.16;
export const LIVE_MIN_SPEECH_SECONDS = 0.9;
export const LIVE_SPEECH_RMS = 0.01;
export const LIVE_OVERLAP_SECONDS = 1.05;
export const LIVE_UNSTABLE_TAIL_SECONDS = 0.32;
export const LIVE_QC_CONTEXT_SECONDS = 2;
export const LIVE_QC_OVERLAP_SECONDS = 0.8;
export const LIVE_QC_RECENT_WORDS = 12;
export const LIVE_QC_PHRASE_WORDS = 8;
export const LIVE_QC_STALL_SECONDS = 0.5;

export interface LiveQcBuffer {
  chunks: LiveQcChunk[];
  sampleCount: number;
  pendingSampleCount: number;
  cursor: number;
}

interface LiveQcChunk {
  samples: Float32Array;
  cursor: number;
  startSeconds: number;
}

export interface LiveQcWindow {
  samples: Float32Array;
  cursor: number;
  startSeconds: number;
}

export function createLiveQcBuffer(): LiveQcBuffer {
  return { chunks: [], sampleCount: 0, pendingSampleCount: 0, cursor: 0 };
}

export function appendLiveQcSamples(
  buffer: LiveQcBuffer,
  samples: Float32Array,
  cursor: number,
  startSeconds = 0,
): LiveQcBuffer {
  if (samples.length === 0) {
    return buffer;
  }
  return {
    chunks: [...buffer.chunks, {
      samples,
      cursor: Math.max(0, Math.floor(cursor)),
      startSeconds: Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0,
    }],
    sampleCount: buffer.sampleCount + samples.length,
    pendingSampleCount: buffer.pendingSampleCount + samples.length,
    cursor: buffer.sampleCount === 0 ? Math.max(0, Math.floor(cursor)) : buffer.cursor,
  };
}

export function drainLiveQcBuffer(
  buffer: LiveQcBuffer,
  sampleRate: number,
  force = false,
  goldCursor?: number,
): { buffer: LiveQcBuffer; window?: LiveQcWindow } {
  if (buffer.sampleCount === 0 || buffer.chunks.length === 0) {
    return { buffer };
  }

  const phraseStart = buffer.cursor;
  const phraseEnd = phraseStart + LIVE_QC_PHRASE_WORDS;
  const gold = Number.isFinite(goldCursor) ? Math.floor(goldCursor as number) : phraseStart;
  const coveredThrough = buffer.chunks.reduce((maxCursor, chunk) => Math.max(maxCursor, chunk.cursor), phraseStart);
  const leftoverSamples = buffer.chunks
    .filter((chunk) => chunk.cursor === coveredThrough)
    .reduce((count, chunk) => count + chunk.samples.length, 0);
  const enoughSpeech = leftoverSamples >= Math.max(1, Math.floor(sampleRate * LIVE_QC_STALL_SECONDS));
  const stalledOnWord = gold === coveredThrough && enoughSpeech;
  const goldJumpedPast = gold > coveredThrough && enoughSpeech;
  if (!force && gold < phraseEnd && !stalledOnWord && !goldJumpedPast) {
    return { buffer };
  }

  const take = force
    ? buffer.chunks
    : (stalledOnWord || goldJumpedPast) && gold < phraseEnd + LIVE_QC_PHRASE_WORDS
      ? buffer.chunks.filter((chunk) => chunk.cursor <= Math.min(gold, coveredThrough))
      : buffer.chunks.filter((chunk) => chunk.cursor < phraseEnd);
  const keep = force
    ? []
    : buffer.chunks.filter((chunk) => !take.includes(chunk));
  if (take.length === 0) {
    return { buffer };
  }

  const samples = concatLiveQcChunks(take);
  if (samples.length === 0) {
    return { buffer };
  }

  return {
    buffer: {
      chunks: keep,
      sampleCount: keep.reduce((count, chunk) => count + chunk.samples.length, 0),
      pendingSampleCount: keep.reduce((count, chunk) => count + chunk.samples.length, 0),
      cursor: keep[0]?.cursor ?? phraseEnd,
    },
    window: {
      samples,
      cursor: take[0]?.cursor ?? phraseStart,
      startSeconds: take[0]?.startSeconds ?? 0,
    },
  };
}

function concatLiveQcChunks(chunks: LiveQcChunk[]): Float32Array {
  const sampleCount = chunks.reduce((count, chunk) => count + chunk.samples.length, 0);
  const samples = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk.samples, offset);
    offset += chunk.samples.length;
  }
  return samples;
}

const LIVE_RESYNC_LOOKAHEAD = 8;
const LIVE_NEAR_JUMP = 3;
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
  let pendingResync = input.state.pendingResync;
  let matchedInWindow = 0;
  let flag: LiveMismatch | undefined;

  const words = usableLiveWords(input.transcript);

  for (const [wordIndex, word] of words.entries()) {
    const heard = normalizeToken(word.text);
    if (!heard) {
      continue;
    }
    if (word.end <= lastHeardEnd) {
      continue;
    }
    const confirmsRepeatedResync = pendingResync?.text === heard;
    if (isRecentHeardDuplicate(recentHeard, heard, word.end) && !confirmsRepeatedResync) {
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
    if (heard === expected || wordsSimilar(heard, expected) || sameSpokenNumber(heard, expected)) {
      cursor += 1;
      pendingResync = undefined;
      matchedInWindow += 1;
      continue;
    }

    const nearJump = !input.flagsEnabled ? findNearJump(heard, input.expected, cursor) : -1;
    if (nearJump >= 0) {
      cursor = nearJump + 1;
      pendingResync = undefined;
      matchedInWindow += 1;
      continue;
    }
    if (!input.flagsEnabled && (isReliableShortSwap(expected, heard) || isNumberSlip(expected, heard))) {
      cursor += 1;
      pendingResync = undefined;
      matchedInWindow += 1;
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
        pendingResync = undefined;
        matchedInWindow += 2;
        const confirmed = words[wordIndex + 1];
        if (confirmed) {
          lastHeardEnd = Math.max(lastHeardEnd, confirmed.end);
          rememberHeard(recentHeard, nextHeard, confirmed.end);
        }
        continue;
      }
    }

    const lookaheadOffset = lookahead.findIndex((candidate) => normalizeToken(candidate.text) === heard);
    if (lookaheadOffset >= 0) {
      const expectedIndex = cursor + lookaheadOffset + 1;
      const confidence = Number.isFinite(word.confidence) ? Math.min(1, Math.max(0, word.confidence as number)) : 0;
      const isDistinctiveResync = !input.flagsEnabled
        && confidence >= Math.max(threshold, 0.8)
        && heard.length >= 5
        && isContentWord(heard)
        && lookahead.filter((candidate) => normalizeToken(candidate.text) === heard).length === 1;
      if (isDistinctiveResync) {
        cursor = expectedIndex + 1;
        pendingResync = undefined;
        matchedInWindow += 1;
        continue;
      }
      const confirmsPending = pendingResync != null && (
        expectedIndex === pendingResync.expectedIndex + 1
        || (expectedIndex === pendingResync.expectedIndex && heard === pendingResync.text)
      );
      if (confirmsPending) {
        cursor = expectedIndex + 1;
        pendingResync = undefined;
        matchedInWindow += 1;
      } else {
        pendingResync = { text: heard, expectedIndex };
      }
      continue;
    }
    pendingResync = undefined;

    const confidence = Number.isFinite(word.confidence) ? Math.min(1, Math.max(0, word.confidence as number)) : 0;
    const reliableShortSwap = input.flagShortWords
      && confidence >= Math.max(threshold, 0.95)
      && isReliableShortSwap(expected, heard);
    if (confidence < threshold || (!reliableShortSwap && (!isContentWord(heard) || !isContentWord(expected)))) {
      continue;
    }

    const id = `live-${input.chapterId}-${expectedWord.index}-${heard}`;
    const hasFlagAnchor = matchedInWindow > 0
      || hasTwoWordTrailingAnchor(words, wordIndex, input.expected, cursor);
    if (input.flagsEnabled && !flag && !dismissedIds.has(id) && (!input.requireFlagAnchor || hasFlagAnchor)) {
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
    matchedInWindow += 1;
  }

  return {
    state: {
      cursor,
      lastHeardEnd,
      recentHeard: recentHeard.slice(-RECENT_HEARD_LIMIT),
      ...(pendingResync ? { pendingResync } : {}),
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

export function liveRequestStatus(streaming: boolean): "listening" | "processing" {
  return streaming ? "listening" : "processing";
}

export function liveVoiceStatusCopy(input: {
  status: "off" | "starting" | "listening" | "processing" | "error";
  enabled: boolean;
  dimmed: boolean;
  error: string | null;
  heardText: string;
}): { title: string; detail: string } {
  if (input.dimmed) {
    return input.enabled
      ? { title: "Following", detail: "Word checks paused; voice follow is still running." }
      : { title: "Paused", detail: input.error ?? "" };
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

/** Whisper QC: mark a swap. Never move the gold cursor or use the stream clock. */
export function liveBackFlag(input: LiveMatchInput): LiveMismatch | undefined {
  const words = usableLiveWords(input.transcript);
  if (words.length === 0 || input.expected.length === 0) {
    return undefined;
  }

  const originalCursor = Math.max(0, Math.min(input.expected.length, Math.floor(input.state.cursor)));
  const gold = Number.isFinite(input.goldCursor)
    ? Math.max(0, Math.floor(input.goldCursor as number))
    : originalCursor + LIVE_QC_PHRASE_WORDS;
  const alignment = alignWhisperWords(words, input.expected, originalCursor, gold);
  const confidenceThreshold = Number.isFinite(input.confidenceThreshold)
    ? Math.min(1, Math.max(0, input.confidenceThreshold as number))
    : 0.9;
  const exactAnchors = alignment.pairs.filter((pair) => pair.kind === "exact").length;
  const hasAnchor = exactAnchors > 0;
  const requireAnchor = input.requireFlagAnchor ?? true;

  for (const pair of alignment.pairs) {
    if (pair.kind === "exact") {
      continue;
    }
    const heardWord = words[pair.heardIndex];
    const expectedWord = input.expected[pair.expectedIndex];
    if (!heardWord || !expectedWord) {
      continue;
    }
    const heard = normalizeToken(heardWord.text);
    const expected = normalizeToken(expectedWord.text);
    const confidence = Number.isFinite(heardWord.confidence)
      ? Math.min(1, Math.max(0, heardWord.confidence as number))
      : 0;
    if (!heard || !expected || confidence < confidenceThreshold) {
      continue;
    }
    if (isWhisperWordPiece(heard, expected)) {
      continue;
    }
    if (pair.expectedIndex >= gold || pair.expectedIndex + LIVE_QC_PHRASE_WORDS < gold) {
      continue;
    }
    if (CLOSED_CLASS.has(heard) && !isReliableShortSwap(expected, heard) && !expected.startsWith(heard) && !expected.endsWith(heard)) {
      continue;
    }
    const id = `live-${input.chapterId}-${expectedWord.index}-${heard}`;
    if (input.dismissedIds?.includes(id)) {
      continue;
    }
    if (requireAnchor && !hasAnchor) {
      continue;
    }
    if (isStaleLiveFlag(pair.expectedIndex, input.goldCursor)) {
      continue;
    }
    return {
      id,
      expected: expectedWord.text,
      heard: heardWord.text,
      expectedIndex: expectedWord.index,
      lineIndex: expectedWord.lineIndex,
      start: Math.max(0, heardWord.start),
      end: Math.max(Math.max(0, heardWord.start), heardWord.end),
      confidence,
    };
  }

  // A one-word, already-positioned check is the only case where there is no
  // surrounding phrase to anchor against. Keep the old useful behavior for a
  // mid-read content-word substitution, while never turning a first-word
  // Whisper hallucination into a pickup.
  if (!hasAnchor && words.length === 1 && originalCursor > 0) {
    const heardWord = words[0];
    const expectedWord = input.expected[originalCursor];
    const heard = normalizeToken(heardWord?.text ?? "");
    const expected = normalizeToken(expectedWord?.text ?? "");
    const confidence = Number.isFinite(heardWord?.confidence)
      ? Math.min(1, Math.max(0, heardWord?.confidence as number))
      : 0;
    if (heardWord && expectedWord && confidence >= confidenceThreshold && isContentWord(heard) && isContentWord(expected) && !isWhisperWordPiece(heard, expected)) {
      const id = `live-${input.chapterId}-${expectedWord.index}-${heard}`;
      if (!input.dismissedIds?.includes(id) && expectedWord.index < gold && expectedWord.index + LIVE_QC_PHRASE_WORDS >= gold && !isStaleLiveFlag(expectedWord.index, input.goldCursor)) {
        return {
          id,
          expected: expectedWord.text,
          heard: heardWord.text,
          expectedIndex: expectedWord.index,
          lineIndex: expectedWord.lineIndex,
          start: Math.max(0, heardWord.start),
          end: Math.max(Math.max(0, heardWord.start), heardWord.end),
          confidence,
        };
      }
    }
  }
  return undefined;
}

interface WhisperAlignmentPair {
  heardIndex: number;
  expectedIndex: number;
  kind: "exact" | "similar" | "mismatch";
}

interface WhisperAlignment {
  pairs: WhisperAlignmentPair[];
}

const WHISPER_ALIGNMENT_GAP_EXPECTED = -1.25;
const WHISPER_ALIGNMENT_GAP_HEARD = -2.25;
const WHISPER_ALIGNMENT_MISMATCH = -2.2;
const WHISPER_ALIGNMENT_SIMILAR = 2.6;
const WHISPER_ALIGNMENT_EXACT = 4;

function alignWhisperWords(
  words: LiveTranscriptWord[],
  expected: LiveExpectedWord[],
  originalCursor: number,
  goldCursor: number,
): WhisperAlignment {
  const end = Math.max(0, Math.min(expected.length, goldCursor));
  const start = Math.max(0, Math.min(originalCursor, Math.max(0, end - LIVE_QC_PHRASE_WORDS)));
  const expectedSlice = expected.slice(start, end);
  const rows = words.length + 1;
  const columns = expectedSlice.length + 1;
  const scores = Array.from({ length: rows }, () => new Array<number>(columns).fill(Number.NEGATIVE_INFINITY));
  const previous = Array.from({ length: rows }, () => new Array<"diag" | "up" | "left" | null>(columns).fill(null));
  scores[0]![0] = 0;
  // The rolling Whisper window may begin in the middle of the phrase. Do not
  // force its first token to match the cursor checkpoint; use the best local
  // sequence inside the nearby manuscript slice instead.
  for (let column = 1; column < columns; column += 1) {
    scores[0]![column] = 0;
    previous[0]![column] = "left";
  }
  for (let row = 1; row < rows; row += 1) {
    scores[row]![0] = (scores[row - 1]?.[0] ?? Number.NEGATIVE_INFINITY) + WHISPER_ALIGNMENT_GAP_HEARD;
    previous[row]![0] = "up";
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const heard = normalizeToken(words[row - 1]?.text ?? "");
      const manuscript = normalizeToken(expectedSlice[column - 1]?.text ?? "");
      const similarity = tokenSimilarity(heard, manuscript);
      const diagonal = (scores[row - 1]?.[column - 1] ?? Number.NEGATIVE_INFINITY)
        + (heard === manuscript || sameSpokenNumber(heard, manuscript) ? WHISPER_ALIGNMENT_EXACT : similarity >= 0.45 ? WHISPER_ALIGNMENT_SIMILAR : WHISPER_ALIGNMENT_MISMATCH);
      const up = (scores[row - 1]?.[column] ?? Number.NEGATIVE_INFINITY) + WHISPER_ALIGNMENT_GAP_HEARD;
      const left = (scores[row]?.[column - 1] ?? Number.NEGATIVE_INFINITY) + WHISPER_ALIGNMENT_GAP_EXPECTED;
      if (diagonal >= up && diagonal >= left) {
        scores[row]![column] = diagonal;
        previous[row]![column] = "diag";
      } else if (up >= left) {
        scores[row]![column] = up;
        previous[row]![column] = "up";
      } else {
        scores[row]![column] = left;
        previous[row]![column] = "left";
      }
    }
  }

  let bestColumn = 0;
  for (let column = 1; column < columns; column += 1) {
    if ((scores[rows - 1]?.[column] ?? Number.NEGATIVE_INFINITY) > (scores[rows - 1]?.[bestColumn] ?? Number.NEGATIVE_INFINITY)) {
      bestColumn = column;
    }
  }

  const pairs: WhisperAlignmentPair[] = [];
  let row = rows - 1;
  let column = bestColumn;
  while (row > 0 || column > 0) {
    const direction = previous[row]?.[column];
    if (direction === "diag") {
      const heard = normalizeToken(words[row - 1]?.text ?? "");
      const manuscript = normalizeToken(expectedSlice[column - 1]?.text ?? "");
      const similarity = tokenSimilarity(heard, manuscript);
      pairs.unshift({
        heardIndex: row - 1,
        expectedIndex: start + column - 1,
        kind: heard === manuscript || sameSpokenNumber(heard, manuscript) ? "exact" : similarity >= 0.45 ? "similar" : "mismatch",
      });
      row -= 1;
      column -= 1;
    } else if (direction === "up") {
      row -= 1;
    } else if (direction === "left") {
      column -= 1;
    } else {
      break;
    }
  }
  return { pairs };
}

function tokenSimilarity(heardText: string, expectedText: string): number {
  const heard = normalizeToken(heardText);
  const expected = normalizeToken(expectedText);
  if (!heard || !expected) {
    return 0;
  }
  if (heard === expected || sameSpokenNumber(heard, expected)) {
    return 1;
  }
  const distance = editDistance(heard, expected);
  return 1 - distance / Math.max(heard.length, expected.length);
}

export function parseParakeetLiveLine(line: string): LiveTranscriptWord[] {
  try {
    const parsed = JSON.parse(line) as { words?: Array<{ w?: string; word?: string; start?: number; end?: number; conf?: number }> };
    if (!Array.isArray(parsed.words)) {
      return [];
    }
    const words: LiveTranscriptWord[] = [];
    for (const item of parsed.words) {
      const text = String(item?.w ?? item?.word ?? "").replace(/<EOU>|<EOB>/giu, "").trim();
      const start = Number(item?.start);
      const end = Number(item?.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        continue;
      }
      const confidence = Number(item?.conf);
      words.push({
        text,
        start,
        end,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.75,
      });
    }
    return words;
  } catch {
    return [];
  }
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

export function isStaleLiveFlag(expectedIndex: number, goldCursor?: number): boolean {
  if (!Number.isFinite(goldCursor)) {
    return false;
  }
  return expectedIndex + LIVE_QC_RECENT_WORDS < Math.floor(goldCursor as number);
}

function findNearJump(heard: string, expected: LiveExpectedWord[], cursor: number): number {
  const window = expected.slice(cursor + 1, cursor + 1 + LIVE_NEAR_JUMP);
  const hits = window.flatMap((candidate, offset) => {
    const token = normalizeToken(candidate.text);
    if (!token || (token !== heard && !wordsSimilar(heard, token) && !sameSpokenNumber(heard, token))) {
      return [];
    }
    return [{ index: cursor + 1 + offset, offset }];
  });
  if (hits.length !== 1) {
    return -1;
  }
  const hit = hits[0];
  if (!hit) {
    return -1;
  }
  if (isContentWord(heard) || hit.offset === 0 || heard.length >= 5) {
    return hit.index;
  }
  return -1;
}

function hasTwoWordTrailingAnchor(
  words: LiveTranscriptWord[],
  wordIndex: number,
  expected: LiveExpectedWord[],
  cursor: number,
): boolean {
  const firstHeard = normalizeToken(words[wordIndex + 1]?.text ?? "");
  const secondHeard = normalizeToken(words[wordIndex + 2]?.text ?? "");
  const firstExpected = normalizeToken(expected[cursor + 1]?.text ?? "");
  const secondExpected = normalizeToken(expected[cursor + 2]?.text ?? "");
  return Boolean(
    firstHeard
      && secondHeard
      && firstExpected
      && secondExpected
      && (firstHeard === firstExpected || wordsSimilar(firstHeard, firstExpected))
      && (secondHeard === secondExpected || wordsSimilar(secondHeard, secondExpected)),
  );
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

const DETERMINERS = new Set(["a", "an", "the", "this", "that", "these", "those"]);
const PREPOSITIONS = new Set(["at", "by", "for", "from", "in", "into", "of", "off", "on", "onto", "to", "too"]);
const PRONOUNS = new Set([
  "he", "her", "hers", "him", "his", "i", "it", "its", "me", "my", "mine",
  "our", "ours", "she", "their", "theirs", "them", "they", "us", "we", "you", "your", "yours",
]);
const AUXILIARIES = new Set([
  "am", "are", "be", "been", "being", "did", "do", "does", "had", "has", "have",
  "is", "was", "were",
]);
const CLOSED_CLASS = new Set([...DETERMINERS, ...PREPOSITIONS, ...PRONOUNS, ...AUXILIARIES]);

function isReliableShortSwap(expected: string, heard: string): boolean {
  if (!expected || !heard || expected === heard) {
    return false;
  }
  return (DETERMINERS.has(expected) && DETERMINERS.has(heard))
    || (PREPOSITIONS.has(expected) && PREPOSITIONS.has(heard))
    || (PRONOUNS.has(expected) && PRONOUNS.has(heard))
    || (AUXILIARIES.has(expected) && AUXILIARIES.has(heard))
    || isNumberSlip(expected, heard);
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60,
  seventieth: 70, eightieth: 80, ninetieth: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
};

function numberValue(token: string): number | undefined {
  const raw = token.toLocaleLowerCase("en-US").replace(/,/g, "");
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  const ordinalDigits = raw.match(/^(\d+)(?:st|nd|rd|th)$/);
  if (ordinalDigits) {
    return Number(ordinalDigits[1]);
  }
  let total = 0;
  let current = 0;
  let seen = false;
  let index = 0;
  const keys = [...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(SCALES)]
    .sort((left, right) => right.length - left.length);
  while (index < raw.length) {
    const rest = raw.slice(index);
    const piece = keys.find((key) => rest.startsWith(key));
    if (!piece) {
      return undefined;
    }
    if (ONES[piece] != null) {
      current += ONES[piece];
    } else if (TENS[piece] != null) {
      current += TENS[piece];
    } else if (SCALES[piece] != null) {
      current = Math.max(current, 1) * SCALES[piece];
      if (SCALES[piece] >= 1_000) {
        total += current;
        current = 0;
      }
    } else {
      return undefined;
    }
    seen = true;
    index += piece.length;
  }
  return seen ? total + current : undefined;
}

function sameSpokenNumber(heard: string, expected: string): boolean {
  const left = numberValue(heard);
  const right = numberValue(expected);
  return left != null && left === right;
}

function isNumberSlip(expected: string, heard: string): boolean {
  const left = numberValue(expected);
  const right = numberValue(heard);
  return left != null && right != null && left !== right;
}

function isContentWord(token: string): boolean {
  return (token.length >= 4 && !FUNCTION_WORDS.has(token)) || numberValue(token) != null;
}

function isWhisperWordPiece(heard: string, expected: string): boolean {
  if (!heard || !expected || heard === expected) {
    return false;
  }
  if (isReliableShortSwap(expected, heard) || isInflectionSlip(heard, expected) || isOnsetClip(heard, expected)) {
    return false;
  }
  const shorter = heard.length <= expected.length ? heard : expected;
  const longer = heard.length <= expected.length ? expected : heard;
  if (CLOSED_CLASS.has(shorter)) {
    return false;
  }
  return longer.includes(shorter) && shorter !== longer;
}

function isOnsetClip(heard: string, expected: string): boolean {
  if (!heard || !expected || heard === expected) {
    return false;
  }
  const shorter = heard.length <= expected.length ? heard : expected;
  const longer = heard.length <= expected.length ? expected : heard;
  const dropped = longer.slice(0, longer.length - shorter.length);
  return longer.endsWith(shorter) && dropped.length > 0 && dropped.length <= 2;
}

function isInflectionSlip(heard: string, expected: string): boolean {
  if (!heard || !expected || heard === expected) {
    return false;
  }
  const shorter = heard.length <= expected.length ? heard : expected;
  const longer = heard.length <= expected.length ? expected : heard;
  if (shorter.length < 3) {
    return false;
  }
  return ["s", "es", "ed", "ing", "er", "est"].some((suffix) => longer === `${shorter}${suffix}`);
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
