import { normalizeToken } from "../proof/normalize";
import { pickupLineRange, pickupLineSeconds, pickupLineText } from "./pickup-line";
import type { Pickup, Seat } from "../project/types";

export interface LiveExpectedWord {
  index: number;
  lineIndex: number;
  /** Global first-word index of the wrapped row shown in line-follow mode. */
  visualLineStart?: number;
  text: string;
  /** Set when the punctuation after this word closes a sentence. */
  endsSentence?: boolean;
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
  /**
   * An unbroken run of words read differently from the page. Carried between
   * calls because a streaming window holds a word or two, far fewer than a run
   * worth stopping a narrator for.
   */
  mismatchRun?: LiveMismatchRun;
}

/** Where a divergence from the page began, and how long it has gone on. */
export interface LiveMismatchRun {
  count: number;
  /** Manuscript index of the first word of the run: where the read left the page. */
  expectedIndex: number;
  heard: string;
  start: number;
  end: number;
  confidence: number;
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
  /**
   * The sentence this word sits in: what a narrator listens back to and what
   * they re-record. `start`/`end` stay the word itself, which is what the
   * teleprompter marks on the page.
   */
  lineStart?: number;
  lineEnd?: number;
  lineText?: string;
}

export interface LiveMatchResult {
  state: LiveMatchState;
  /** Canonical manuscript words placed on this recording clock. */
  confirmed: LiveWordConfirmation[];
  flag?: LiveMismatch;
  /**
   * The word the read stopped on. Only set under `haltOnMismatch`. The cursor
   * in `state` sits on this word and the rest of the window is left unread, so
   * calling again with the returned state resumes from exactly here.
   */
  halt?: LiveMismatch;
}

export interface LiveWordConfirmation {
  expectedIndex: number;
  start: number;
  end: number;
  confidence: number;
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
  /**
   * Stop the page once the read has left it for several words running, and hold
   * it there until the narrator says to carry on.
   *
   * A run, never a single word. One word off the page is nearly always the
   * recogniser mishearing a clean read, and stopping a narrator mid-sentence
   * for that is worse than the mistake: it breaks a take that was fine. Several
   * words in a row is the narrator genuinely lost — a skipped line, the wrong
   * paragraph — which no amount of resyncing fixes and which they want to know
   * about. Every recovery path still runs, so a slip the matcher can place
   * never begins a run at all.
   */
  haltOnMismatch?: boolean;
  /** Confidence a heard word needs before it can count towards a run. */
  haltConfidenceThreshold?: number;
  /** Words in a row that must miss the page before the read stops. */
  haltRunWords?: number;
  /**
   * Manuscript index the narrator has already chosen to continue past. That one
   * word matches under the ordinary tolerant rules so the read can move again,
   * whether they re-read it or carry straight on to the next word.
   */
  haltResumeIndex?: number;
}

export const LIVE_CONTEXT_SECONDS = 1.6;
export const LIVE_HOP_SECONDS = 0.55;
export const LIVE_STREAM_HOP_SECONDS = 0.16;
export const LIVE_MIN_SPEECH_SECONDS = 0.9;
export const LIVE_SPEECH_RMS = 0.01;
export const LIVE_OVERLAP_SECONDS = 1.05;
export const LIVE_UNSTABLE_TAIL_SECONDS = 0.32;
/**
 * Speech kept in front of a QC window after it has already been graded. A drain
 * boundary lands on a hop, not on a pause, so without run-up the window can open
 * partway through its own first word; clipping 150ms off the head costs ten
 * points of detection and clipping 250ms costs twenty-four, and the loss is pure
 * recall — the flag never appears rather than appearing wrongly.
 *
 * The budget counts speech rather than wall-clock because boundaries fall in
 * pauses as often as mid-word. Half a second of run-up across the gap after
 * "…along the horizon." is half a second of silence, and the next window still
 * opens on its own first word: read live, "France" spoken as "Spain" is heard by
 * Whisper at 0.96 confidence and still raises nothing, because a mismatch with
 * no known word to its left cannot be told apart from a clipped onset. Reaching
 * back past the pause to the previous word flags the same audio at 0.93, and
 * back two words at 0.97.
 *
 * Two words, not one, because a word cut by the previous boundary is replayed
 * at the head of this window: one word of run-up would make that word the
 * opening word again and lose it for the same reason. The budget has to cover
 * the replayed word and an anchor in front of it.
 */
export const LIVE_QC_PREROLL_SPEECH_SECONDS = 0.85;
/** However long the narrator's pause, replay at most this much run-up. */
export const LIVE_QC_PREROLL_MAX_SECONDS = 1.6;
export const LIVE_QC_OVERLAP_SECONDS = 0.8;
export const LIVE_QC_RECENT_WORDS = 12;
export const LIVE_QC_PHRASE_WORDS = 8;
export const LIVE_QC_STALL_SECONDS = 0.5;
/**
 * Confidence a heard word needs before it counts towards stopping a read.
 *
 * Lower than the flagging bar on purpose. A flag is a claim about the take that
 * survives the session, so it has to be nearly certain; a stop is a question
 * put to the narrator, who is standing right there and can wave it off with one
 * button. The streaming follow model also reports 0.75 for words it gives no
 * score for, so a bar at the flagging threshold would never stop anything on
 * that path. It is the run length below, not this number, that keeps a stop
 * from firing on recogniser noise.
 */
export const LIVE_HALT_CONFIDENCE = 0.6;

/**
 * Words in a row that must miss the page before the read stops.
 *
 * One word is the wrong unit. Almost every single-word miss is the recogniser,
 * not the narrator: a mispronunciation it did not expect, a name it has never
 * seen, a word swallowed by a breath. Stopping the page for one of those
 * interrupts a narrator who was reading correctly, which costs more than the
 * miss it was reporting — and the matcher already has better answers for a
 * single word, since it can jump, resync, or flag and carry on.
 *
 * Three consecutive misses cannot be explained that way. By then the read has
 * left the page and no resync has brought it back, which is the state worth
 * stopping for: a skipped line, a jump to the wrong paragraph, a narrator who
 * has lost their place. Three is the shortest run that still means that, so it
 * is the least interruption that catches it.
 */
export const LIVE_HALT_RUN_WORDS = 3;

export interface LiveQcBuffer {
  chunks: LiveQcChunk[];
  sampleCount: number;
  pendingSampleCount: number;
  cursor: number;
  /**
   * Already-graded tail of the previous window, replayed as run-up. Held apart
   * from `chunks` so it never counts towards a drain decision or gets graded a
   * second time.
   */
  preroll: LiveQcChunk[];
}

interface LiveQcChunk {
  samples: Float32Array;
  /** Manuscript cursor before this hop's audio was interpreted. */
  cursor: number;
  /** Farthest manuscript cursor covered after interpreting this hop. */
  coveredCursor: number;
  startSeconds: number;
}

export interface LiveQcWindow {
  samples: Float32Array;
  cursor: number;
  startSeconds: number;
  /** Gold position when this audio was drained, not when QC finishes. */
  goldCursor: number;
}

export function createLiveQcBuffer(): LiveQcBuffer {
  return { chunks: [], sampleCount: 0, pendingSampleCount: 0, cursor: 0, preroll: [] };
}

export function appendLiveQcSamples(
  buffer: LiveQcBuffer,
  samples: Float32Array,
  cursor: number,
  startSeconds = 0,
  coveredCursor = cursor,
): LiveQcBuffer {
  if (samples.length === 0) {
    return buffer;
  }
  return {
    chunks: [...buffer.chunks, {
      samples,
      cursor: Math.max(0, Math.floor(cursor)),
      coveredCursor: Math.max(Math.max(0, Math.floor(cursor)), Math.max(0, Math.floor(coveredCursor))),
      startSeconds: Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0,
    }],
    sampleCount: buffer.sampleCount + samples.length,
    pendingSampleCount: buffer.pendingSampleCount + samples.length,
    cursor: buffer.sampleCount === 0 ? Math.max(0, Math.floor(cursor)) : buffer.cursor,
    preroll: buffer.preroll,
  };
}

/** Voiced seconds in a hop, counted in short frames like a gate would. */
function speechSeconds(samples: Float32Array, sampleRate: number): number {
  const frame = Math.max(1, Math.floor(sampleRate * 0.02));
  let voiced = 0;
  for (let start = 0; start + frame <= samples.length; start += frame) {
    if (pcmHasSpeech(samples.subarray(start, start + frame))) {
      voiced += 1;
    }
  }
  return (voiced * frame) / sampleRate;
}

/**
 * Trailing chunks holding `seconds` of speech, oldest first. Silence is carried
 * but not counted, so a span measured from a boundary inside a pause still
 * reaches back to the word on the other side of the pause.
 */
function trailingSpeechChunks(chunks: LiveQcChunk[], sampleRate: number, seconds: number): LiveQcChunk[] {
  const cap = Math.max(0, Math.floor(sampleRate * LIVE_QC_PREROLL_MAX_SECONDS));
  if (cap === 0 || seconds <= 0) {
    return [];
  }
  const result: LiveQcChunk[] = [];
  let count = 0;
  let speech = 0;
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (!chunk) {
      continue;
    }
    if (result.length > 0 && count + chunk.samples.length > cap) {
      break;
    }
    result.unshift(chunk);
    count += chunk.samples.length;
    speech += speechSeconds(chunk.samples, sampleRate);
    if (speech >= seconds) {
      break;
    }
  }
  return result;
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
  const coveredThrough = buffer.chunks.reduce((maxCursor, chunk) => Math.max(maxCursor, chunk.coveredCursor), phraseStart);
  const leftoverSamples = buffer.chunks
    .filter((chunk) => chunk.coveredCursor === coveredThrough)
    .reduce((count, chunk) => count + chunk.samples.length, 0);
  // A half-second stall is enough to decide that the follow model stopped
  // advancing, but it is too short to give Whisper a reliable acoustic
  // context. Keep buffering until the normal minimum speech window before
  // asking the slower back-check model to judge a stalled phrase.
  const enoughSpeech = leftoverSamples >= Math.max(
    1,
    Math.floor(sampleRate * Math.max(LIVE_QC_STALL_SECONDS, LIVE_MIN_SPEECH_SECONDS)),
  );
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

  // Keep a small amount of audio immediately after the phrase in the QC
  // buffer, but include it in this request as overlap. It gives Whisper an
  // exact trailing anchor for the final word without consuming the next
  // phrase's samples (which remain queued for its own check).
  //
  // Stalls and gold jumps get this too. They drain a subset of the buffer, so
  // later audio already exists to anchor against, and without it the window ends
  // mid-word: read live, a window cut after "…LeBlanc kneel" came back as
  // "LeBlancNiel over a low tape" and the dropped plural went unreported. Only a
  // forced flush has nothing left to borrow.
  const overlap = !force
    ? (() => {
        const needed = Math.max(1, Math.floor(sampleRate * LIVE_QC_OVERLAP_SECONDS));
        const result: LiveQcChunk[] = [];
        let count = 0;
        for (const chunk of buffer.chunks) {
          if (take.includes(chunk)) {
            continue;
          }
          result.push(chunk);
          count += chunk.samples.length;
          if (count >= needed) {
            break;
          }
        }
        return result;
      })()
    : [];
  // Run-up first, so the window's own first word is never the audio's first
  // word. The overlap path is skipped on every stall and forced flush, which is
  // most of a real session, so the guard cannot live there.
  const preroll = buffer.preroll;
  const samples = concatLiveQcChunks([...preroll, ...take, ...overlap]);
  if (samples.length === 0) {
    return { buffer };
  }
  // A stalled follow cursor has no trustworthy word boundary yet. Grade the
  // whole phrase-sized manuscript slice so Whisper has exact anchors around
  // a substitution (for example `at` → `in`) instead of a one-word range
  // that can never establish an alignment.
  const overlapGold = [...take, ...overlap].reduce(
    (maxCursor, chunk) => Math.max(maxCursor, chunk.cursor + 1, chunk.coveredCursor),
    phraseEnd,
  );
  const windowGold = force ? gold : overlapGold;

  const head = preroll[0] ?? take[0];
  return {
    buffer: {
      chunks: keep,
      sampleCount: keep.reduce((count, chunk) => count + chunk.samples.length, 0),
      pendingSampleCount: keep.reduce((count, chunk) => count + chunk.samples.length, 0),
      cursor: keep[0]?.cursor ?? phraseEnd,
      preroll: trailingSpeechChunks([...preroll, ...take], sampleRate, LIVE_QC_PREROLL_SPEECH_SECONDS),
    },
    window: {
      samples,
      // The window opens where its audio opens. Run-up words sit outside the
      // flaggable range, so they buy alignment anchors without buying verdicts.
      cursor: head?.cursor ?? phraseStart,
      startSeconds: head?.startSeconds ?? 0,
      goldCursor: windowGold,
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
// Narrators can skip a sentence or a paragraph while the follow model is
// catching up. A short rolling hop should still be able to rejoin on a
// distinctive two-word anchor without pinning the page forever.
const LIVE_LONG_RESYNC_LOOKAHEAD = 64;
const LIVE_NEAR_JUMP = 3;
/** A reread is local: at most a few wrapped lines or one short paragraph. */
const LIVE_BACKTRACK_LOOKBEHIND = 48;
/** Two words farther apart than this are not one spoken repair anchor. */
const LIVE_BACKTRACK_ANCHOR_GAP_SECONDS = 1.25;
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
 * Words narrators use between an abandoned read and its replacement. They are
 * ignored only when they do not match the current manuscript word, so a book
 * that genuinely says "sorry" or "again" still follows normally.
 */
const REPAIR_CUE_TOKENS = new Set(["again", "oops", "restart", "sorry", "start"]);

/**
 * Consume a rolling ASR window. Exact words and close mishears advance follow;
 * a bounded unique phrase can move it back when a narrator clearly restarts.
 * A high-confidence real mismatch still advances and flags, so a stumble does
 * not pin the page. Hallucinated silence tokens and overlapped copies are
 * ignored.
 *
 * Under `haltOnMismatch` a read that misses the page for `haltRunWords` in a
 * row pins the page and returns a `halt`. The cursor goes back to the first
 * word of that run and the remainder of the window is left unread, so nothing
 * is graded against a position the narrator has not reached. Shorter runs
 * behave as they always do: one misheard word must not stop a narrator who is
 * reading correctly.
 */
export function matchLiveWindow(input: LiveMatchInput): LiveMatchResult {
  let cursor = Math.max(0, Math.min(input.expected.length, Math.floor(input.state.cursor)));
  let lastHeardEnd = Number.isFinite(input.state.lastHeardEnd) ? Math.max(0, input.state.lastHeardEnd) : 0;
  const recentHeard = [...(input.state.recentHeard ?? [])];
  const threshold = Number.isFinite(input.confidenceThreshold)
    ? Math.min(1, Math.max(0, input.confidenceThreshold as number))
    : 0.9;
  const haltThreshold = Number.isFinite(input.haltConfidenceThreshold)
    ? Math.min(1, Math.max(0, input.haltConfidenceThreshold as number))
    : LIVE_HALT_CONFIDENCE;
  const haltResumeIndex = Number.isFinite(input.haltResumeIndex)
    ? Math.floor(input.haltResumeIndex as number)
    : -1;
  const haltRunWords = Number.isFinite(input.haltRunWords)
    ? Math.max(1, Math.floor(input.haltRunWords as number))
    : LIVE_HALT_RUN_WORDS;
  const dismissedIds = new Set(input.dismissedIds ?? []);
  let pendingResync = input.state.pendingResync;
  let mismatchRun = input.state.mismatchRun;
  let matchedInWindow = 0;
  let flag: LiveMismatch | undefined;
  let halt: LiveMismatch | undefined;
  const confirmed: LiveWordConfirmation[] = [];

  const confirmWord = (expectedIndex: number, word: LiveTranscriptWord | undefined) => {
    if (!word || !Number.isFinite(word.start) || !Number.isFinite(word.end)) {
      return;
    }
    const start = Math.max(0, word.start);
    const end = Math.max(start, word.end);
    confirmed.push({
      expectedIndex,
      start,
      end,
      confidence: Number.isFinite(word.confidence)
        ? Math.min(1, Math.max(0, word.confidence as number))
        : 0,
    });
  };

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
    // Every branch that places a word on the page ends a run of misses, the
    // same way it clears a pending resync. A run has to be unbroken to mean
    // anything: one word the matcher could not place is noise, but three in a
    // row with nothing landing between them is a read that has left the page.
    if (sameWord(heard, expected) || wordsSimilar(heard, expected)) {
      confirmWord(expectedWord.index, word);
      cursor += 1;
      pendingResync = undefined;
      mismatchRun = undefined;
      matchedInWindow += 1;
      continue;
    }

    // Repetitions and false starts are non-monotonic. A strict left-to-right
    // cursor treats the repeated words as off-page speech and stops before the
    // correction can arrive. Follow a bounded, unique rough-copy anchor back
    // instead. Two words are enough at a visible line start; elsewhere three
    // are required unless the pair contains a distinctive content word.
    if (!input.flagsEnabled) {
      const backtrack = findBackwardRepair(recentHeard, input.expected, cursor);
      if (backtrack >= 0) {
        confirmWord(input.expected[backtrack - 1]?.index ?? (backtrack - 1), word);
        cursor = backtrack;
        pendingResync = undefined;
        mismatchRun = undefined;
        matchedInWindow += 1;
        continue;
      }
    }

    // An editing phrase sits between a false start and the replacement. It is
    // neither manuscript progress nor evidence that the narrator is lost.
    if (!input.flagsEnabled && REPAIR_CUE_TOKENS.has(heard)) {
      pendingResync = undefined;
      mismatchRun = undefined;
      continue;
    }

    const nearJump = !input.flagsEnabled ? findNearJump(heard, input.expected, cursor) : -1;
    if (nearJump >= 0) {
      const jumpHalt = forwardLineJumpHalt(input, mismatchRun?.expectedIndex ?? cursor, nearJump, word, words);
      if (jumpHalt) {
        halt = jumpHalt;
        cursor = jumpHalt.expectedIndex;
        pendingResync = undefined;
        mismatchRun = undefined;
        break;
      }
      confirmWord(input.expected[nearJump]?.index ?? nearJump, word);
      cursor = nearJump + 1;
      pendingResync = undefined;
      mismatchRun = undefined;
      matchedInWindow += 1;
      continue;
    }
    if (!input.flagsEnabled && (isReliableShortSwap(expected, heard) || isNumberSlip(expected, heard))) {
      confirmWord(expectedWord.index, word);
      cursor += 1;
      pendingResync = undefined;
      mismatchRun = undefined;
      matchedInWindow += 1;
      continue;
    }

    const nextHeard = normalizeToken(words[wordIndex + 1]?.text ?? "");
    if (!input.flagsEnabled) {
      const longResync = findLongResync(heard, nextHeard, input.expected, cursor, threshold);
      if (longResync >= 0) {
        const jumpHalt = forwardLineJumpHalt(input, mismatchRun?.expectedIndex ?? cursor, longResync, word, words);
        if (jumpHalt) {
          halt = jumpHalt;
          cursor = jumpHalt.expectedIndex;
          pendingResync = undefined;
          mismatchRun = undefined;
          break;
        }
        confirmWord(input.expected[longResync]?.index ?? longResync, word);
        if (nextHeard) {
          confirmWord(input.expected[longResync + 1]?.index ?? (longResync + 1), words[wordIndex + 1]);
        }
        cursor = longResync + (nextHeard ? 2 : 1);
        pendingResync = undefined;
        mismatchRun = undefined;
        matchedInWindow += nextHeard ? 2 : 1;
        if (nextHeard) {
          const confirmed = words[wordIndex + 1];
          if (confirmed) {
            lastHeardEnd = Math.max(lastHeardEnd, confirmed.end);
            rememberHeard(recentHeard, nextHeard, confirmed.end);
          }
        }
        continue;
      }
    }
    const lookahead = input.expected.slice(cursor + 1, cursor + 1 + LIVE_RESYNC_LOOKAHEAD);
    if (nextHeard) {
      const resyncOffset = lookahead.findIndex((candidate, candidateOffset) => (
        normalizeToken(candidate.text) === heard
        && normalizeToken(lookahead[candidateOffset + 1]?.text ?? "") === nextHeard
      ));
      if (resyncOffset >= 0) {
        const placedIndex = cursor + resyncOffset + 1;
        const jumpHalt = forwardLineJumpHalt(input, mismatchRun?.expectedIndex ?? cursor, placedIndex, word, words);
        if (jumpHalt) {
          halt = jumpHalt;
          cursor = jumpHalt.expectedIndex;
          pendingResync = undefined;
          mismatchRun = undefined;
          break;
        }
        confirmWord(input.expected[placedIndex]?.index ?? placedIndex, word);
        confirmWord(input.expected[placedIndex + 1]?.index ?? (placedIndex + 1), words[wordIndex + 1]);
        cursor += resyncOffset + 3;
        pendingResync = undefined;
        mismatchRun = undefined;
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
        const jumpHalt = forwardLineJumpHalt(input, mismatchRun?.expectedIndex ?? cursor, expectedIndex, word, words);
        if (jumpHalt) {
          halt = jumpHalt;
          cursor = jumpHalt.expectedIndex;
          pendingResync = undefined;
          mismatchRun = undefined;
          break;
        }
        confirmWord(input.expected[expectedIndex]?.index ?? expectedIndex, word);
        cursor = expectedIndex + 1;
        pendingResync = undefined;
        mismatchRun = undefined;
        matchedInWindow += 1;
        continue;
      }
      const confirmsPending = pendingResync != null && (
        expectedIndex === pendingResync.expectedIndex + 1
        || (expectedIndex === pendingResync.expectedIndex && heard === pendingResync.text)
      );
      if (confirmsPending) {
        const jumpHalt = forwardLineJumpHalt(input, mismatchRun?.expectedIndex ?? cursor, expectedIndex, word, words);
        if (jumpHalt) {
          halt = jumpHalt;
          cursor = jumpHalt.expectedIndex;
          pendingResync = undefined;
          mismatchRun = undefined;
          break;
        }
        confirmWord(input.expected[expectedIndex]?.index ?? expectedIndex, word);
        cursor = expectedIndex + 1;
        pendingResync = undefined;
        mismatchRun = undefined;
        matchedInWindow += 1;
      } else {
        pendingResync = { text: heard, expectedIndex };
      }
      continue;
    }
    pendingResync = undefined;

    const confidence = Number.isFinite(word.confidence) ? Math.min(1, Math.max(0, word.confidence as number)) : 0;

    // No recovery could place this word, so the read has missed the page here.
    // Count it, and stop only once the run is long enough to mean the narrator
    // is lost rather than the recogniser being wrong. The count is kept on its
    // own confidence bar, below the flagging one, because the follow model
    // scores most words too low to flag and a run still has to be countable
    // there. Below the run length nothing happens, and the word goes on to be
    // flagged and stepped over exactly as it would with stopping switched off.
    if (input.haltOnMismatch) {
      const haltShortSwap = confidence >= Math.max(haltThreshold, 0.95)
        && isReliableShortSwap(expected, heard);
      const countsTowardsRun = confidence >= haltThreshold
        && (haltShortSwap || (isContentWord(heard) && isContentWord(expected)));
      if (countsTowardsRun) {
        const start = Math.max(0, word.start);
        const end = Math.max(start, word.end);
        mismatchRun = mismatchRun
          ? { ...mismatchRun, count: mismatchRun.count + 1, end }
          : { count: 1, expectedIndex: cursor, heard: word.text, start, end, confidence };
        const startedRead = input.expected[mismatchRun.expectedIndex];
        if (mismatchRun.count >= haltRunWords && startedRead && mismatchRun.expectedIndex !== haltResumeIndex) {
          halt = {
            id: `live-${input.chapterId}-${startedRead.index}-${normalizeToken(mismatchRun.heard)}`,
            expected: startedRead.text,
            heard: mismatchRun.heard,
            expectedIndex: startedRead.index,
            lineIndex: startedRead.lineIndex,
            start: mismatchRun.start,
            end: mismatchRun.end,
            confidence: mismatchRun.confidence,
            ...liveLineContext(
              input.expected,
              mismatchRun.expectedIndex,
              mismatchRun.start,
              mismatchRun.end,
              words,
            ),
          };
          // Back to where the read left the page, not to where it was noticed.
          // Those are three words apart, and the first is the one the narrator
          // has to pick the line back up from.
          cursor = mismatchRun.expectedIndex;
          mismatchRun = undefined;
          break;
        }
      }
    }

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
      const start = Math.max(0, word.start);
      const end = Math.max(start, word.end);
      flag = {
        id,
        expected: expectedWord.text,
        heard: word.text,
        expectedIndex: expectedWord.index,
        lineIndex: expectedWord.lineIndex,
        start,
        end,
        confidence,
        ...liveLineContext(input.expected, expectedWord.index, start, end, words),
      };
    }
    confirmWord(expectedWord.index, word);
    cursor += 1;
    matchedInWindow += 1;
  }

  return {
    state: {
      cursor,
      lastHeardEnd,
      recentHeard: recentHeard.slice(-RECENT_HEARD_LIMIT),
      ...(pendingResync ? { pendingResync } : {}),
      ...(mismatchRun ? { mismatchRun } : {}),
    },
    confirmed,
    flag,
    halt,
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

export type LiveVoiceStatus = "off" | "starting" | "listening" | "paused" | "processing" | "error";

export function liveVoiceStatusCopy(input: {
  status: LiveVoiceStatus;
  enabled: boolean;
  dimmed: boolean;
  error: string | null;
  heardText: string;
}): { title: string; detail: string } {
  if (input.status === "paused" && input.enabled) {
    return {
      title: "Paused",
      detail: "Your place is held. Break audio is not being saved.",
    };
  }
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

/**
 * The sentence around a flagged word, in both manuscript and audio terms.
 *
 * Attached to every flag as it is raised, because this is the only moment the
 * manuscript is in hand: by the time a pickup reaches Review it carries word
 * text and timestamps but no way back to the page it came from.
 */
function liveLineContext(
  expected: LiveExpectedWord[],
  expectedIndex: number,
  start: number,
  end: number,
  heardWords: readonly LiveTranscriptWord[],
  pairs: readonly WhisperAlignmentPair[] = [],
): Pick<LiveMismatch, "lineStart" | "lineEnd" | "lineText"> {
  const range = pickupLineRange(expected, expectedIndex);
  if (!range) {
    return {};
  }
  const pairedSentenceWords = pairs
    .filter((pair) => pair.expectedIndex >= range.from && pair.expectedIndex <= range.to)
    .map((pair) => heardWords[pair.heardIndex])
    .filter((word): word is LiveTranscriptWord => word !== undefined);
  const bounds = pickupLineSeconds(
    pairedSentenceWords.length > 0 ? pairedSentenceWords : heardWords,
    { start, end },
  );
  return {
    lineStart: bounds.start,
    lineEnd: bounds.end,
    lineText: pickupLineText(expected, range),
  };
}

/**
 * What the narrator reads on the stop banner. Name the page word first: they
 * are looking for the place to pick the read back up, not for a verdict. The
 * page has been stopped because the read drifted off it for several words, so
 * the wording points at the line rather than blaming the one word.
 */
export function liveHaltCopy(halt: { expected: string; heard: string }): { title: string; detail: string } {
  return {
    title: `Lost the page around “${halt.expected}”`,
    detail: `Heard “${halt.heard}”. Pick the line up here, or continue to carry on from where you are.`,
  };
}

/** Whisper QC: mark a swap. Never move the gold cursor or use the stream clock. */
export function liveBackFlag(input: LiveMatchInput): LiveMismatch | undefined {
  const heardWords = usableLiveWords(input.transcript);
  if (heardWords.length === 0 || input.expected.length === 0) {
    return undefined;
  }

  const originalCursor = Math.max(0, Math.min(input.expected.length, Math.floor(input.state.cursor)));
  const gold = Number.isFinite(input.goldCursor)
    ? Math.max(0, Math.floor(input.goldCursor as number))
    : originalCursor + LIVE_QC_PHRASE_WORDS;
  const bounds = whisperAlignmentBounds(input.expected, originalCursor, gold);
  const words = expandNumberRuns(
    splitGluedHeardWords(heardWords, input.expected, bounds.start, bounds.end),
    input.expected,
    bounds.start,
    bounds.end,
  );
  const alignment = alignWhisperWords(words, input.expected, originalCursor, gold);
  const confidenceThreshold = Number.isFinite(input.confidenceThreshold)
    ? Math.min(1, Math.max(0, input.confidenceThreshold as number))
    : 0.9;
  const exactAnchors = alignment.pairs.filter((pair) => pair.kind === "exact").length;
  const hasAnchor = exactAnchors > 0;
  const requireAnchor = input.requireFlagAnchor ?? true;
  let pronunciationFallback: LiveMismatch | undefined;
  let reportedStrongerSlip = false;

  for (const [pairIndex, pair] of alignment.pairs.entries()) {
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
    if (!heard || !expected) {
      continue;
    }
    if (isWhisperWordPiece(heard, expected)) {
      continue;
    }
    if (pair.expectedIndex >= gold || pair.expectedIndex + LIVE_QC_PHRASE_WORDS < gold) {
      continue;
    }
    const hasStrongAnchor = hasStrongLocalWhisperAnchor(alignment.pairs, pairIndex);
    const candidateThreshold = hasStrongAnchor
      ? anchoredWhisperThreshold(expected, heard, confidenceThreshold, hasImmediateExactNeighbours(alignment.pairs, pairIndex))
      : confidenceThreshold;
    if (confidence < candidateThreshold) {
      continue;
    }
    if (CLOSED_CLASS.has(heard) && !isReliableShortSwap(expected, heard) && !expected.startsWith(heard) && !expected.endsWith(heard)) {
      continue;
    }
    // Narrators swap one small word for another. A function word paired with
    // an unrelated content word is the alignment reaching for somewhere to put
    // a stray Whisper token, not a slip the narrator would want to re-record.
    if (isFunctionWord(expected) && !isFunctionWord(heard) && !isPlausibleSlip(expected, heard)) {
      continue;
    }
    const id = `live-${input.chapterId}-${expectedWord.index}-${heard}`;
    if (input.dismissedIds?.includes(id)) {
      if (pair.kind !== "similar" || isPlausibleSlip(expected, heard)) {
        reportedStrongerSlip = true;
      }
      continue;
    }
    if (requireAnchor && !hasAnchor) {
      continue;
    }
    if (isStaleLiveFlag(pair.expectedIndex, input.goldCursor)) {
      continue;
    }
    const candidateStart = Math.max(0, heardWord.start);
    const candidateEnd = Math.max(candidateStart, heardWord.end);
    const candidate: LiveMismatch = {
      id,
      expected: expectedWord.text,
      heard: heardWord.text,
      expectedIndex: expectedWord.index,
      lineIndex: expectedWord.lineIndex,
      start: candidateStart,
      end: candidateEnd,
      confidence,
      ...liveLineContext(
        input.expected,
        expectedWord.index,
        candidateStart,
        candidateEnd,
        words,
        alignment.pairs,
      ),
    };
    const isUnclassifiedSimilar = pair.kind === "similar"
      && !isReliableShortSwap(expected, heard)
      && !isInflectionSlip(heard, expected)
      && !isOnsetClip(heard, expected)
      && !isNumberSlip(expected, heard);
    if (isUnclassifiedSimilar) {
      // Hold a likely pronunciation/orthography variant as a fallback so it
      // cannot hide a later, stronger narrator-slip class in the same phrase.
      pronunciationFallback ??= candidate;
      continue;
    }
    return candidate;
  }

  // The fallback exists so a pronunciation variant cannot hide a real slip
  // class in the same phrase. Once that slip has been reported, the leftover
  // variant is Whisper mishearing a correctly read word: not a pickup.
  if (pronunciationFallback && !reportedStrongerSlip) {
    return pronunciationFallback;
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
        const loneStart = Math.max(0, heardWord.start);
        const loneEnd = Math.max(loneStart, heardWord.end);
        return {
          id,
          expected: expectedWord.text,
          heard: heardWord.text,
          expectedIndex: expectedWord.index,
          lineIndex: expectedWord.lineIndex,
          start: loneStart,
          end: loneEnd,
          confidence,
          ...liveLineContext(input.expected, expectedWord.index, loneStart, loneEnd, [heardWord]),
        };
      }
    }
  }
  return undefined;
}

/**
 * Whisper prints two spoken words with no space between them when the
 * separator lands in a token that carries no letters (`such 'the` becomes
 * `suchthe`, `twenty-hundred` becomes `twentyhundred`). Split such a token
 * back apart when its halves land on two consecutive manuscript words, so the
 * phrase can still be graded. Only the manuscript decides the split, so this
 * is not tied to any particular book or narrator.
 */
function splitGluedHeardWords(
  words: LiveTranscriptWord[],
  expected: LiveExpectedWord[],
  start: number,
  end: number,
): LiveTranscriptWord[] {
  const window = expected.slice(start, end).map((word) => normalizeToken(word.text)).filter(Boolean);
  if (window.length < 2) {
    return words;
  }
  const result: LiveTranscriptWord[] = [];
  for (const word of words) {
    const heard = normalizeToken(word.text);
    const split = heard.length >= 6 && !window.some((candidate) => sameWord(heard, candidate))
      ? findGlueSplit(heard, window)
      : undefined;
    if (!split) {
      result.push(word);
      continue;
    }
    const cut = word.start + Math.max(0, word.end - word.start) * (split.left.length / heard.length);
    result.push({ text: split.left, start: word.start, end: cut, confidence: word.confidence });
    result.push({ text: split.right, start: cut, end: word.end, confidence: word.confidence });
  }
  return result;
}

function findGlueSplit(heard: string, window: string[]): { left: string; right: string } | undefined {
  for (let cut = 2; cut <= heard.length - 2; cut += 1) {
    const left = heard.slice(0, cut);
    const right = heard.slice(cut);
    for (let index = 0; index + 1 < window.length; index += 1) {
      const first = window[index] ?? "";
      const second = window[index + 1] ?? "";
      const leftFits = sameWord(left, first);
      const rightFits = sameWord(right, second);
      if ((leftFits && rightFits)
        || (leftFits && isPlausibleSlip(second, right))
        || (rightFits && isPlausibleSlip(first, left))) {
        return { left, right };
      }
    }
  }
  return undefined;
}

const NUMBER_RUN_WORDS = 6;

/**
 * Prose spells numbers out; Whisper writes them as digits. `seventeen hundred
 * and forty` comes back as `1740`, which would otherwise align against a
 * single manuscript word and read as a wrong number. When a numeric token
 * carries the same value as a run of manuscript number words, the narrator
 * read that run correctly: restore the manuscript's own words so the phrase
 * aligns exactly.
 */
function expandNumberRuns(
  words: LiveTranscriptWord[],
  expected: LiveExpectedWord[],
  start: number,
  end: number,
): LiveTranscriptWord[] {
  const window = expected.slice(start, end);
  if (window.length < 2) {
    return words;
  }
  const result: LiveTranscriptWord[] = [];
  for (const word of words) {
    const heard = normalizeToken(word.text);
    const value = numberValue(heard);
    const run = value == null ? undefined : findNumberRun(heard, value, window) ?? misreadNumberRun(heard, window);
    if (!run) {
      result.push(word);
      continue;
    }
    const duration = Math.max(0, word.end - word.start);
    const step = run.length > 0 ? duration / run.length : 0;
    run.forEach((token, offset) => {
      result.push({
        text: offset === 0 && token === MISREAD_NUMBER ? word.text : token,
        start: word.start + step * offset,
        end: word.start + step * (offset + 1),
        confidence: word.confidence,
      });
    });
  }
  return result;
}

const MISREAD_NUMBER = "\u0000misread";

/**
 * A wrong number also arrives as one digit token spanning several manuscript
 * words. Line the rest of the run up exactly and leave the digits against its
 * first word, so the pickup lands on the number the narrator has to re-read
 * instead of on whichever word the alignment happened to reach.
 */
function misreadNumberRun(heard: string, window: LiveExpectedWord[]): string[] | undefined {
  if ((heard.match(/\d/gu) ?? []).length < 3) {
    return undefined;
  }
  const runs: string[][] = [[]];
  for (const word of window) {
    const token = normalizeToken(word.text);
    if (token && (numberValue(token) != null || token === "and")) {
      runs.at(-1)?.push(token);
      continue;
    }
    runs.push([]);
  }
  const spans = runs
    .map((run) => {
      let last = run.length;
      while (last > 0 && numberValue(run[last - 1] ?? "") == null) {
        last -= 1;
      }
      return run.slice(0, last);
    })
    .filter((run) => run.length >= 2);
  const only = spans.length === 1 ? spans[0] : undefined;
  return only ? [MISREAD_NUMBER, ...only.slice(1)] : undefined;
}

function findNumberRun(heard: string, value: number, window: LiveExpectedWord[]): string[] | undefined {
  for (let index = 0; index < window.length; index += 1) {
    const run: string[] = [];
    for (let length = 0; length < NUMBER_RUN_WORDS && index + length < window.length; length += 1) {
      const token = normalizeToken(window[index + length]?.text ?? "");
      if (!token || (numberValue(token) == null && token !== "and")) {
        break;
      }
      run.push(token);
      if (run.length < 2 || run.at(-1) === "and") {
        continue;
      }
      const spelled = run.filter((entry) => entry !== "and");
      if (numberValue(spelled.join("")) === value || digitsRenderNumberRun(heard, spelled)) {
        return run;
      }
    }
  }
  return undefined;
}

/**
 * Times and years are read as several numbers and written as one digit string:
 * `six forty-six` becomes `646`, `eight thirty-five` becomes `835`. The run's
 * arithmetic value (52, 38) is not what Whisper printed, so check whether the
 * digits are the run read out in groups before calling the number wrong.
 */
function digitsRenderNumberRun(heard: string, run: string[]): boolean {
  if (!/^\d+$/u.test(heard)) {
    return false;
  }
  const matches = (digitIndex: number, runIndex: number): boolean => {
    if (digitIndex === heard.length && runIndex === run.length) {
      return true;
    }
    for (let length = 1; runIndex + length <= run.length; length += 1) {
      const value = numberValue(run.slice(runIndex, runIndex + length).join(""));
      if (value == null) {
        break;
      }
      const rendered = String(value);
      if (heard.startsWith(rendered, digitIndex) && matches(digitIndex + rendered.length, runIndex + length)) {
        return true;
      }
    }
    return false;
  };
  return matches(0, 0);
}

/** A substitution a narrator could plausibly make on this manuscript word. */
function isPlausibleSlip(expected: string, heard: string): boolean {
  return isReliableShortSwap(expected, heard)
    || isNumberSlip(expected, heard)
    || isInflectionSlip(heard, expected)
    || isOnsetClip(heard, expected)
    || wordsSimilar(heard, expected);
}

function hasStrongLocalWhisperAnchor(
  pairs: WhisperAlignmentPair[],
  pairIndex: number,
): boolean {
  let exactBefore = false;
  let exactAfter = false;
  let exactAfterCount = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index]?.kind !== "exact") {
      continue;
    }
    if (index < pairIndex) {
      exactBefore = true;
    } else if (index > pairIndex) {
      exactAfter = true;
      exactAfterCount += 1;
    }
  }
  // A phrase can begin exactly at the substitution (for example, “The sea
  // glides…”). Two exact trailing words provide the same local guard when no
  // preceding token is present in the QC window.
  return (exactBefore && exactAfter) || (!exactBefore && exactAfter && exactAfterCount >= 2);
}

/**
 * A word whose immediate neighbours both match the manuscript exactly is
 * pinned in place: the only open question is which word was spoken there.
 * That is a much stronger position than "some exact word exists in this
 * window", so it earns a lower confidence floor below.
 */
function hasImmediateExactNeighbours(pairs: WhisperAlignmentPair[], pairIndex: number): boolean {
  const anchored = (index: number): boolean => pairs[index]?.kind === "exact";
  if (anchored(pairIndex - 1) && anchored(pairIndex + 1)) {
    return true;
  }
  // A QC window can open on the substitution itself. Two exact words directly
  // after it pin the position just as well as one on each side.
  return pairIndex === 0 && anchored(1) && anchored(2);
}

function anchoredWhisperThreshold(expected: string, heard: string, base: number, pinned: boolean): number {
  // Whisper spreads probability across equivalent surface forms, so a real
  // slip can be reported at a low token probability purely because `fifth`
  // competed with `5th`, or `eye` with `eyes`. When the position is pinned by
  // exact neighbours and the substitution belongs to a bounded class, accept
  // that weaker score instead of dropping the pickup.
  const bounded = isNumberSlip(expected, heard)
    || isInflectionSlip(heard, expected)
    || isOnsetClip(heard, expected)
    || isReliableShortSwap(expected, heard);
  if (pinned && bounded) {
    return Math.min(base, 0.35);
  }
  if (isNumberSlip(expected, heard)) {
    return Math.min(base, 0.55);
  }
  if (isInflectionSlip(heard, expected)) {
    return Math.min(base, 0.62);
  }
  if (isOnsetClip(heard, expected)) {
    return Math.min(base, 0.7);
  }
  if (isReliableShortSwap(expected, heard)) {
    // Whisper is often least certain on a one-syllable determiner/preposition
    // even when both neighboring content words are exact. With two local
    // anchors this is still a bounded substitution, so retain it at .50.
    return Math.min(base, 0.5);
  }
  // Content-word substitutions can also receive conservative token
  // probabilities (especially names and place names). Only use this lower
  // floor when exact anchors exist on both sides (or two trailing anchors at
  // a phrase start), so an unanchored hallucination remains suppressed.
  return Math.min(base, 0.6);
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
// A transcript word that cannot fit the manuscript should be cheaper to drop
// than to force-pair as a narrator slip. This matters for rolling QC windows:
// they commonly include a few words before/after the phrase checkpoint.
const WHISPER_ALIGNMENT_MISMATCH = -3;
// Narrators substitute within a word class far more often than across it, so
// a leftover content word belongs against the content word it displaced
// rather than against the little word beside it.
const WHISPER_ALIGNMENT_CROSS_CLASS = -3.6;
const WHISPER_ALIGNMENT_SHORT_SWAP = -1.8;
const WHISPER_ALIGNMENT_SIMILAR = 2.6;
const WHISPER_ALIGNMENT_EXACT = 4;

function whisperMismatchScore(heard: string, manuscript: string): number {
  return isFunctionWord(heard) === isFunctionWord(manuscript)
    ? WHISPER_ALIGNMENT_MISMATCH
    : WHISPER_ALIGNMENT_CROSS_CLASS;
}

/**
 * Include a trailing phrase of manuscript context. QC audio often contains
 * overlap beyond the drained phrase; consuming all of those Whisper words
 * against a slice that ends exactly at gold can otherwise force DP to pair a
 * later trailing word with the slip at the phrase boundary.
 */
function whisperAlignmentBounds(
  expected: LiveExpectedWord[],
  originalCursor: number,
  goldCursor: number,
): { start: number; end: number } {
  const end = Math.max(0, Math.min(expected.length, goldCursor + LIVE_QC_PHRASE_WORDS));
  const start = Math.max(0, Math.min(originalCursor, Math.max(0, end - LIVE_QC_PHRASE_WORDS)));
  return { start, end };
}

function alignWhisperWords(
  words: LiveTranscriptWord[],
  expected: LiveExpectedWord[],
  originalCursor: number,
  goldCursor: number,
): WhisperAlignment {
  const { start, end } = whisperAlignmentBounds(expected, originalCursor, goldCursor);
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
      const shortSwap = isReliableShortSwap(manuscript, heard) || isNumberSlip(manuscript, heard);
      const diagonal = (scores[row - 1]?.[column - 1] ?? Number.NEGATIVE_INFINITY)
        + (sameWord(heard, manuscript)
          ? WHISPER_ALIGNMENT_EXACT
          : similarity >= 0.45
            ? WHISPER_ALIGNMENT_SIMILAR
            : shortSwap
              ? WHISPER_ALIGNMENT_SHORT_SWAP
              : whisperMismatchScore(heard, manuscript));
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
        kind: sameWord(heard, manuscript) ? "exact" : similarity >= 0.45 ? "similar" : "mismatch",
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
  if (sameWord(heard, expected)) {
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
  const lineStart = Number.isFinite(flag.lineStart) ? Math.max(0, flag.lineStart as number) : undefined;
  const lineEnd = Number.isFinite(flag.lineEnd) ? Math.max(lineStart ?? 0, flag.lineEnd as number) : undefined;
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
    manuscript_index: flag.expectedIndex,
    ...(lineStart !== undefined && lineEnd !== undefined ? { line_start: lineStart, line_end: lineEnd } : {}),
    ...(flag.lineText ? { line_text: flag.lineText } : {}),
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

/**
 * Find a recent spoken phrase behind the cursor. This is deliberately bounded
 * and uniqueness-gated: a common word such as "the" must never drag a live
 * prompter backwards, while "Beyond the" at the start of the current line is
 * strong evidence that the narrator restarted it.
 */
function findBackwardRepair(
  recentHeard: LiveHeardToken[],
  expected: LiveExpectedWord[],
  cursor: number,
): number {
  const floor = Math.max(0, cursor - LIVE_BACKTRACK_LOOKBEHIND);
  for (const length of [3, 2]) {
    if (recentHeard.length < length) {
      continue;
    }
    const heard = recentHeard.slice(-length);
    const first = heard[0];
    const last = heard[heard.length - 1];
    if (!first || !last || last.end - first.end > LIVE_BACKTRACK_ANCHOR_GAP_SECONDS) {
      continue;
    }
    const tokens = heard.map((word) => word.text);
    if (tokens.some((token) => REPAIR_CUE_TOKENS.has(token))) {
      continue;
    }
    const hits: number[] = [];
    for (let start = floor; start + length < cursor; start += 1) {
      if (tokens.every((token, offset) => {
        const candidate = normalizeToken(expected[start + offset]?.text ?? "");
        return sameWord(token, candidate) || wordsSimilar(token, candidate);
      })) {
        hits.push(start);
      }
    }
    if (hits.length !== 1) {
      continue;
    }
    const start = hits[0]!;
    const startsFollowLine = start === 0 || liveLineKey(expected[start - 1]) !== liveLineKey(expected[start]);
    const hasDistinctiveWord = tokens.some((token) => isContentWord(token) && token.length >= 5);
    if (length >= 3 || startsFollowLine || hasDistinctiveWord) {
      return start + length;
    }
  }
  return -1;
}

/**
 * A forward anchor is useful when ASR loses words inside a line, but it must
 * not silently approve a narrator omitting the rest of a line (or more). One
 * missing final word is tolerated because streaming ASR commonly finalizes the
 * next line's onset before the preceding tail.
 */
function shouldStopAtForwardLineJump(
  expected: LiveExpectedWord[],
  cursor: number,
  target: number,
): boolean {
  const current = expected[cursor];
  const destination = expected[target];
  if (!current || !destination) {
    return false;
  }
  const currentLine = liveLineKey(current);
  if (liveLineKey(destination) === currentLine) {
    return false;
  }
  let unreadCurrentLine = 0;
  for (let index = cursor; index < expected.length && liveLineKey(expected[index]) === currentLine; index += 1) {
    unreadCurrentLine += 1;
  }
  let crossedLines = 0;
  let priorLine = currentLine;
  for (let index = cursor + 1; index <= target; index += 1) {
    const nextLine = liveLineKey(expected[index]);
    if (nextLine !== priorLine) {
      crossedLines += 1;
      priorLine = nextLine;
    }
  }
  return crossedLines > 1 || unreadCurrentLine > 1;
}

function liveLineKey(word: LiveExpectedWord | undefined): string {
  return word?.visualLineStart === undefined
    ? `manuscript:${word?.lineIndex ?? -1}`
    : `visual:${word.visualLineStart}`;
}

/** Add browser-measured wrapped rows to the words used by live follow. */
export function applyLiveVisualRows(
  expected: LiveExpectedWord[],
  rows: ReadonlyArray<{ from: number; to: number }>,
): LiveExpectedWord[] {
  if (rows.length === 0) {
    return expected;
  }
  return expected.map((word) => {
    const row = rows.find((candidate) => word.index >= candidate.from && word.index <= candidate.to);
    return row ? { ...word, visualLineStart: row.from } : word;
  });
}

function forwardLineJumpHalt(
  input: LiveMatchInput,
  cursor: number,
  target: number,
  heardWord: LiveTranscriptWord,
  heardWords: LiveTranscriptWord[],
): LiveMismatch | undefined {
  if (!input.haltOnMismatch || !shouldStopAtForwardLineJump(input.expected, cursor, target)) {
    return undefined;
  }
  const expectedWord = input.expected[cursor];
  if (!expectedWord) {
    return undefined;
  }
  const start = Math.max(0, heardWord.start);
  const end = Math.max(start, heardWord.end);
  const confidence = Number.isFinite(heardWord.confidence)
    ? Math.min(1, Math.max(0, heardWord.confidence as number))
    : 0;
  return {
    id: `live-${input.chapterId}-${expectedWord.index}-${normalizeToken(heardWord.text)}`,
    expected: expectedWord.text,
    heard: heardWord.text,
    expectedIndex: expectedWord.index,
    lineIndex: expectedWord.lineIndex,
    start,
    end,
    confidence,
    ...liveLineContext(input.expected, expectedWord.index, start, end, heardWords),
  };
}

function findNearJump(heard: string, expected: LiveExpectedWord[], cursor: number): number {
  const window = expected.slice(cursor + 1, cursor + 1 + LIVE_NEAR_JUMP);
  const hits = window.flatMap((candidate, offset) => {
    const token = normalizeToken(candidate.text);
    if (!token || (!sameWord(heard, token) && !wordsSimilar(heard, token))) {
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

function findLongResync(
  heard: string,
  nextHeard: string,
  expected: LiveExpectedWord[],
  cursor: number,
  threshold: number,
): number {
  const end = Math.min(expected.length, cursor + 1 + LIVE_LONG_RESYNC_LOOKAHEAD);
  const hits: number[] = [];
  for (let index = cursor + 1; index < end; index += 1) {
    const candidate = normalizeToken(expected[index]?.text ?? "");
    if (!candidate || (!sameWord(heard, candidate) && !wordsSimilar(heard, candidate))) {
      continue;
    }
    if (nextHeard) {
      const following = normalizeToken(expected[index + 1]?.text ?? "");
      if (!sameWord(nextHeard, following) && !wordsSimilar(nextHeard, following)) {
        continue;
      }
    } else {
      const confidence = threshold;
      if (!isContentWord(heard) || heard.length < 5 || confidence < 0.55) {
        continue;
      }
    }
    hits.push(index);
  }
  return hits.length === 1 ? hits[0]! : -1;
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
const PREPOSITIONS = new Set([
  "about", "above", "across", "after", "against", "along", "among", "around",
  "at", "before", "behind", "below", "beneath", "beside", "between", "beyond",
  "by", "down", "during", "for", "from", "in", "inside", "into", "near", "of",
  "off", "on", "onto", "out", "outside", "over", "past", "through",
  "throughout", "to", "too", "toward", "towards", "under", "underneath",
  "until", "up", "upon", "with", "within", "without",
]);
const PRONOUNS = new Set([
  "he", "her", "hers", "him", "his", "i", "it", "its", "me", "my", "mine",
  "our", "ours", "she", "their", "theirs", "them", "they", "us", "we", "you", "your", "yours",
]);
const AUXILIARIES = new Set([
  "am", "are", "be", "been", "being", "did", "do", "does", "had", "has", "have",
  "is", "was", "were",
]);
const CLOSED_CLASS = new Set([...DETERMINERS, ...PREPOSITIONS, ...PRONOUNS, ...AUXILIARIES]);

function isFunctionWord(token: string): boolean {
  return FUNCTION_WORDS.has(token) || CLOSED_CLASS.has(token);
}

/**
 * British and American spellings of one word are not a narrator slip, and
 * Whisper frequently writes contractions and `o'clock` without the
 * apostrophe. Systematic suffix rules carry the common cases; the guards on
 * stem length keep them from folding unrelated short words together (four
 * must not become for). The irregular pairs below have no rule to derive.
 */
const DIALECT_IRREGULAR = new Map([
  ["grey", "gray"],
  ["mould", "mold"],
  ["smoulder", "smolder"],
  ["moustache", "mustache"],
  ["plough", "plow"],
  ["tyre", "tire"],
  ["kerb", "curb"],
  ["pyjamas", "pajamas"],
  ["aluminium", "aluminum"],
  ["jewellery", "jewelry"],
  ["programme", "program"],
  ["aeroplane", "airplane"],
  ["sceptical", "skeptical"],
  ["judgement", "judgment"],
  ["whisky", "whiskey"],
  ["draught", "draft"],
  ["cheque", "check"],
  ["storey", "story"],
  ["gaol", "jail"],
]);

function dialectKey(token: string): string {
  const bare = token.replace(/'/gu, "");
  const irregular = DIALECT_IRREGULAR.get(bare);
  if (irregular) {
    return irregular;
  }
  let key = bare.replace(/(\p{L}{3,})our/u, "$1or");
  if (key.length >= 5) {
    key = key.replace(/(\p{L}{3,})re$/u, "$1er");
  }
  if (key.length >= 6) {
    key = key
      .replace(/is(e|ed|es|ing|ation|ations)$/u, "iz$1")
      .replace(/ys(e|ed|es|ing)$/u, "yz$1")
      .replace(/ogue$/u, "og")
      .replace(/ence$/u, "ense");
  }
  if (key.length >= 8) {
    key = key.replace(/ll(ed|ing|er|est|ous)$/u, "l$1");
  }
  return key;
}

/** One spoken word written two ways: same value, same spelling variant. */
function sameWord(heard: string, expected: string): boolean {
  if (!heard || !expected) {
    return false;
  }
  return heard === expected
    || sameSpokenNumber(heard, expected)
    || dialectKey(heard) === dialectKey(expected);
}

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

export function numberValue(token: string): number | undefined {
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

/** Dropping or adding a plural is the same slip whether or not English is regular about it. */
const IRREGULAR_PLURALS = new Map([
  ["children", "child"],
  ["men", "man"],
  ["women", "woman"],
  ["gentlemen", "gentleman"],
  ["people", "person"],
  ["feet", "foot"],
  ["teeth", "tooth"],
  ["geese", "goose"],
  ["mice", "mouse"],
  ["lice", "louse"],
  ["oxen", "ox"],
  ["lives", "life"],
  ["wives", "wife"],
  ["knives", "knife"],
  ["leaves", "leaf"],
  ["halves", "half"],
  ["shelves", "shelf"],
  ["thieves", "thief"],
  ["wolves", "wolf"],
  ["loaves", "loaf"],
]);

function isInflectionSlip(heard: string, expected: string): boolean {
  if (!heard || !expected || heard === expected) {
    return false;
  }
  const shorter = heard.length <= expected.length ? heard : expected;
  const longer = heard.length <= expected.length ? expected : heard;
  if (IRREGULAR_PLURALS.get(longer) === shorter || IRREGULAR_PLURALS.get(shorter) === longer) {
    return true;
  }
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
