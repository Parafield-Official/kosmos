import type { Pickup, Seat } from "../project/types";
import { pickupLineSeconds } from "../teleprompter/pickup-line";
import {
  manuscriptMatchUnits,
  normalizeToken,
  spokenPieces,
  tokenizeManuscript,
  transcriptMatchUnits,
  type ManuscriptToken,
  type MatchUnit,
} from "./normalize";
import type { SilenceRange } from "./silence";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface AlignTranscriptInput {
  chapterId: string;
  manuscript: string;
  transcript: TranscriptWord[];
  durationSeconds?: number;
  seat?: Seat;
  mergeWindowSeconds?: number;
  /** Gaps longer than this can become a pause pickup when they occur mid-sentence. */
  pauseThresholdSeconds?: number;
  /**
   * Drop word pickups the recogniser was this unsure about. A pickup only faces
   * the gate when the engine actually reported a confidence, so a transcript
   * without confidences is never silently emptied.
   */
  minConfidence?: number;
  /**
   * Words the narrator has decided are fine everywhere in this book, so the
   * same pickup does not have to be dismissed once per chapter.
   */
  suppressedWords?: readonly string[];
  /**
   * Quiet stretches measured from the recording. Recognisers spread a segment's
   * words evenly across its span, so a long silence can arrive as a half-second
   * gap between words; when the audio has been measured, that is what pauses
   * are read from instead.
   */
  silences?: readonly SilenceRange[];
}

export interface AlignmentResult {
  pickups: Pickup[];
  manuscript_tokens: ManuscriptToken[];
  transcript_words: TranscriptWord[];
}

/** Carry human review state forward when a re-proof finds the same pickup. */
export function preservePickupWorkflow(previous: Pickup[], next: Pickup[]): Pickup[] {
  const byId = new Map(previous.map((pickup) => [pickup.id, pickup]));
  const bySignature = new Map<string, Pickup[]>();
  for (const pickup of previous) {
    const key = pickupSignature(pickup);
    const bucket = bySignature.get(key) ?? [];
    bucket.push(pickup);
    bySignature.set(key, bucket);
  }
  const used = new Set<string>();
  return next.map((pickup) => {
    const exact = byId.get(pickup.id);
    const candidate = exact && !used.has(exact.id)
      ? exact
      : (bySignature.get(pickupSignature(pickup)) ?? [])
        .filter((old) => !used.has(old.id))
        .sort((left, right) => Math.abs(left.t_start - pickup.t_start) - Math.abs(right.t_start - pickup.t_start))[0];
    if (!candidate) {
      return pickup;
    }
    used.add(candidate.id);
    return {
      ...pickup,
      status: candidate.status,
      ...(candidate.note ? { note: candidate.note } : {}),
    };
  });
}

type DiffOperation =
  | { kind: "equal"; manuscriptIndex: number; transcriptIndex: number }
  | { kind: "delete"; manuscriptIndex: number }
  | { kind: "insert"; transcriptIndex: number };

interface PickupRun {
  manuscript: ManuscriptToken[];
  transcript: Array<TranscriptWord & { index: number }>;
  previousTranscript?: TranscriptWord;
  nextTranscript?: TranscriptWord;
  /** Whether any contributing word carried a confidence from the engine. */
  confidenceKnown: boolean;
}

/**
 * Compare a manuscript against word-timestamped ASR output. The ASR engine is
 * intentionally an input boundary: this function is deterministic and never
 * calls a cloud service or guesses whether a read is "good".
 */
export function alignTranscript(input: AlignTranscriptInput): AlignmentResult {
  const manuscriptTokens = tokenizeManuscript(input.manuscript);
  const normalizedTranscriptWords = input.transcript
    .filter((word) =>
      typeof word.text === "string"
      && normalizeToken(word.text).length > 0
      && Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.start >= 0
      && word.end >= 0
      && word.end >= word.start,
    )
    .map((word) => ({ ...word, confidence: normalizedConfidence(word.confidence) }));
  const hasDuration = Number.isFinite(input.durationSeconds) && (input.durationSeconds ?? 0) >= 0;
  const durationSeconds = hasDuration
    ? input.durationSeconds as number
    : inferDuration(normalizedTranscriptWords);
  const transcriptWords = hasDuration
    ? normalizedTranscriptWords
      .filter((word) => word.start <= durationSeconds)
      .map((word) => {
        const start = Math.min(durationSeconds, word.start);
        return {
          ...word,
          start,
          end: Math.min(durationSeconds, Math.max(start, word.end)),
        };
      })
    : normalizedTranscriptWords;
  // Compare spoken units rather than raw tokens, so a figure read aloud and a
  // hyphenated compound line up with the words the recogniser reported.
  const manuscriptUnits = manuscriptMatchUnits(manuscriptTokens);
  const transcriptUnits = transcriptMatchUnits(transcriptWords);
  const operations = diffTokens(
    manuscriptUnits.map((unit) => unit.key),
    transcriptUnits.map((unit) => unit.key),
  );
  const minConfidence = Number.isFinite(input.minConfidence)
    ? clamp(input.minConfidence as number, 0, 1)
    : 0;
  const suppressed = normalizeSuppressedWords(input.suppressedWords);
  const pickups: Pickup[] = [];
  let operationIndex = 0;
  let pickupOrdinal = 0;
  let previousTranscript: TranscriptWord | undefined;

  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];
    if (operation.kind === "equal") {
      previousTranscript = lastWordOfUnit(transcriptWords, transcriptUnits[operation.transcriptIndex]);
      operationIndex += 1;
      continue;
    }

    const run: PickupRun = {
      manuscript: [],
      transcript: [],
      previousTranscript,
      confidenceKnown: false,
    };
    while (operationIndex < operations.length && operations[operationIndex].kind !== "equal") {
      const current = operations[operationIndex];
      if (current.kind === "delete") {
        const unit = manuscriptUnits[current.manuscriptIndex];
        for (let token = unit.from; token <= unit.to; token += 1) {
          if (!run.manuscript.some((existing) => existing.index === token)) {
            run.manuscript.push(manuscriptTokens[token]);
          }
        }
      } else {
        const unit = transcriptUnits[current.transcriptIndex];
        for (let word = unit.from; word <= unit.to; word += 1) {
          if (!run.transcript.some((existing) => existing.index === word)) {
            run.transcript.push({ ...transcriptWords[word], index: word });
            if (Number.isFinite(input.transcript[word]?.confidence)) {
              run.confidenceKnown = true;
            }
          }
        }
      }
      operationIndex += 1;
    }

    const next = operations[operationIndex];
    if (next?.kind === "equal") {
      run.nextTranscript = firstWordOfUnit(transcriptWords, transcriptUnits[next.transcriptIndex]);
    }

    const pickup = sameWordsDifferentlySpaced(run)
      ? null
      : runToPickup(
        run,
        input.chapterId,
        durationSeconds,
        input.seat ?? "narration",
        pickupOrdinal,
        input.manuscript,
        manuscriptTokens,
      );
    // A recogniser that reports low confidence is telling us it may have
    // misheard, which makes the mismatch its fault rather than the narrator's.
    const gated = pickup !== null
      && run.confidenceKnown
      && minConfidence > 0
      && pickup.confidence < minConfidence;
    if (pickup && !gated && !isSuppressedPickup(pickup, suppressed)) {
      pickups.push(pickup);
      pickupOrdinal += 1;
    }

    if (run.transcript.length > 0) {
      previousTranscript = run.transcript[run.transcript.length - 1];
    }
  }

  const pausePickups = detectPausePickups({
    chapterId: input.chapterId,
    manuscript: input.manuscript,
    manuscriptTokens,
    transcriptWords,
    operations,
    manuscriptUnits,
    transcriptUnits,
    thresholdSeconds: input.pauseThresholdSeconds ?? 4,
    seat: input.seat ?? "narration",
    durationSeconds,
    startOrdinal: pickupOrdinal,
    silences: input.silences,
  });
  return {
    pickups: mergePickups(
      [...pickups, ...pausePickups].sort((left, right) => left.t_start - right.t_start),
      input.mergeWindowSeconds ?? 0.4,
    ),
    manuscript_tokens: manuscriptTokens,
    transcript_words: transcriptWords,
  };
}

interface PauseDetectionInput {
  chapterId: string;
  manuscript: string;
  manuscriptTokens: ManuscriptToken[];
  transcriptWords: TranscriptWord[];
  operations: DiffOperation[];
  manuscriptUnits: MatchUnit[];
  transcriptUnits: MatchUnit[];
  thresholdSeconds: number;
  seat: Seat;
  durationSeconds: number;
  startOrdinal: number;
  silences?: readonly SilenceRange[];
}

/** Detect only long, mid-sentence gaps; normal breaths and paragraph breaks stay quiet. */
function detectPausePickups(input: PauseDetectionInput): Pickup[] {
  const threshold = Number.isFinite(input.thresholdSeconds)
    ? Math.max(0, input.thresholdSeconds)
    : 4;
  if (threshold <= 0 || input.transcriptWords.length < 2) {
    return [];
  }

  // A matched unit can span several words and several tokens, so record the
  // token range each word landed on rather than a single index.
  const alignedTokens = new Map<number, { from: number; to: number }>();
  for (const operation of input.operations) {
    if (operation.kind !== "equal") {
      continue;
    }
    const manuscriptUnit = input.manuscriptUnits[operation.manuscriptIndex];
    const transcriptUnit = input.transcriptUnits[operation.transcriptIndex];
    if (!manuscriptUnit || !transcriptUnit) {
      continue;
    }
    for (let word = transcriptUnit.from; word <= transcriptUnit.to; word += 1) {
      alignedTokens.set(word, { from: manuscriptUnit.from, to: manuscriptUnit.to });
    }
  }

  const pauses: Pickup[] = [];
  for (const gap of pauseCandidates(input, threshold)) {
    const index = gap.index;
    let previousIndex = index;
    while (previousIndex >= 0 && !alignedTokens.has(previousIndex)) {
      previousIndex -= 1;
    }
    let nextIndex = index + 1;
    while (nextIndex < input.transcriptWords.length && !alignedTokens.has(nextIndex)) {
      nextIndex += 1;
    }
    const previous = input.transcriptWords[previousIndex];
    const next = input.transcriptWords[nextIndex];
    const previousRange = alignedTokens.get(previousIndex);
    const nextRange = alignedTokens.get(nextIndex);
    if (
      previousRange === undefined
      || nextRange === undefined
      || nextRange.from <= previousRange.to
      || nextRange.from - previousRange.to > 3
    ) {
      // A broad unmatched run usually means the reader skipped or inserted
      // text; the word pickup already explains that interval. Permit one or
      // two unmatched tokens beside the measured silence, though: Whisper can
      // stretch a segment across the gap and misrecognise the boundary word.
      continue;
    }
    const previousToken = input.manuscriptTokens[previousRange.to];
    const nextToken = input.manuscriptTokens[nextRange.from];
    const between = input.manuscript.slice(previousToken.end, nextToken.start);
    if (/[.!?。！？\n]/u.test(between)) {
      continue;
    }
    const confidence = Math.min(previous.confidence ?? 0, next.confidence ?? 0);
    pauses.push({
      id: stablePickupId(
        input.chapterId,
        "pause",
        `>${threshold}s`,
        "",
        gap.start,
        gap.end,
        input.startOrdinal + pauses.length,
      ),
      chapter_id: input.chapterId,
      t_start: Math.max(0, gap.start),
      t_end: Math.max(Math.max(0, gap.start), gap.end),
      expected: `Pause > ${threshold}s`,
      heard: "",
      kind: "pause",
      seat: input.seat,
      status: "open",
    confidence: normalizedConfidence(confidence),
    });
  }
  return pauses;
}

interface PauseCandidate {
  /** Index of the transcript word the silence follows. */
  index: number;
  start: number;
  end: number;
}

/**
 * Where the narrator stopped talking. Measured silence wins when we have it,
 * because a recogniser's word timings are an even division of a segment rather
 * than a record of when each word was said.
 */
function pauseCandidates(input: PauseDetectionInput, threshold: number): PauseCandidate[] {
  const words = input.transcriptWords;
  if (input.silences && input.silences.length > 0) {
    const firstStart = words[0].start;
    const lastEnd = words[words.length - 1].end;
    const candidates: PauseCandidate[] = [];
    for (const silence of input.silences) {
      const length = silence.end - silence.start;
      if (!Number.isFinite(length) || length <= threshold) {
        continue;
      }
      // Room tone before the first word or after the last is not a pause in
      // the read.
      if (silence.end <= firstStart || silence.start >= lastEnd) {
        continue;
      }
      let index = -1;
      for (let candidate = 0; candidate < words.length - 1; candidate += 1) {
        if (words[candidate].start <= silence.start) {
          index = candidate;
        }
      }
      if (index < 0) {
        continue;
      }
      candidates.push({ index, start: silence.start, end: silence.end });
    }
    return candidates;
  }

  const candidates: PauseCandidate[] = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    const gap = words[index + 1].start - words[index].end;
    if (Number.isFinite(gap) && gap > threshold) {
      candidates.push({ index, start: words[index].end, end: words[index + 1].start });
    }
  }
  return candidates;
}

/**
 * True when the two sides are the same letters and only the spaces moved:
 * "half-empty" written, "halfempty" heard, or "any more" read as "anymore".
 * Where the break falls is the recogniser's guess, not something the narrator
 * did, so there is nothing to fix.
 */
function sameWordsDifferentlySpaced(run: PickupRun): boolean {
  if (run.manuscript.length === 0 || run.transcript.length === 0) {
    return false;
  }
  const written = joinedLetters(run.manuscript.map((token) => token.text));
  const heard = joinedLetters(run.transcript.map((word) => word.text));
  return written.length > 0 && written === heard;
}

function joinedLetters(parts: string[]): string {
  return parts
    .map((part) => normalizeToken(part).replace(/[^\p{L}\p{N}]+/gu, ""))
    .join("");
}

function runToPickup(
  run: PickupRun,
  chapterId: string,
  durationSeconds: number,
  seat: Seat,
  ordinal: number,
  manuscript: string,
  manuscriptTokens: ManuscriptToken[],
): Pickup | null {
  const expected = run.manuscript.map((token) => token.text).join(" ");
  const heard = run.transcript.map((word) => word.text).join(" ");
  if (expected.length === 0 && heard.length === 0) {
    return null;
  }

  const kind = expected && heard ? "sub" : expected ? "skip" : "insert";
  let tStart = run.previousTranscript?.end ?? 0;
  let tEnd = run.nextTranscript?.start ?? durationSeconds;
  if (run.transcript.length > 0) {
    tStart = Infinity;
    tEnd = -Infinity;
    for (const word of run.transcript) {
      tStart = Math.min(tStart, word.start);
      tEnd = Math.max(tEnd, word.end);
    }
  }
  const confidence = run.transcript.length > 0
    ? average(run.transcript.map((word) => normalizedConfidence(word.confidence)))
    : 0;
  const line = pickupSentenceContext(
    run,
    manuscript,
    manuscriptTokens,
    tStart,
    tEnd,
    durationSeconds,
  );

  return {
    id: stablePickupId(chapterId, kind, expected, heard, tStart, tEnd, ordinal),
    chapter_id: chapterId,
    t_start: Math.max(0, tStart),
    t_end: Math.max(Math.max(0, tStart), tEnd),
    expected,
    heard,
    kind,
    seat,
    status: "open",
    confidence,
    ...line,
  };
}

const SENTENCE_SAFE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "rev", "gen", "lt", "sgt", "capt",
  "col", "jr", "sr", "st", "vs", "etc", "inc", "ltd", "co", "no",
  "fig", "dept", "est", "ft",
]);

function pickupSentenceContext(
  run: PickupRun,
  manuscript: string,
  tokens: ManuscriptToken[],
  wordStart: number,
  wordEnd: number,
  durationSeconds: number,
): Pick<Pickup, "line_start" | "line_end" | "line_text"> {
  const first = run.manuscript[0]?.index;
  const last = run.manuscript.at(-1)?.index;
  if (first === undefined || last === undefined || !tokens[first] || !tokens[last]) {
    return {};
  }

  let from = first;
  while (from > 0 && !sentenceBoundaryBetween(manuscript, tokens[from - 1], tokens[from])) {
    from -= 1;
  }
  let to = last;
  while (to < tokens.length - 1 && !sentenceBoundaryBetween(manuscript, tokens[to], tokens[to + 1])) {
    to += 1;
  }

  const finalToken = tokens[to];
  const following = manuscript.slice(finalToken.end, tokens[to + 1]?.start ?? manuscript.length);
  const punctuation = following.match(/^[.!?。！？…]+(?:["'’”)\]]+)?/u)?.[0] ?? "";
  const lineText = manuscript
    .slice(tokens[from].start, finalToken.end + punctuation.length)
    .replace(/\s+/gu, " ")
    .trim();
  const seconds = pickupLineSeconds({
    wordStart,
    wordEnd,
    wordsBefore: first - from,
    wordsAfter: to - last,
  });
  return {
    line_start: Math.max(0, seconds.start),
    line_end: Math.min(durationSeconds, Math.max(seconds.start, seconds.end)),
    line_text: lineText,
  };
}

function sentenceBoundaryBetween(
  manuscript: string,
  previous: ManuscriptToken,
  next: ManuscriptToken,
): boolean {
  const between = manuscript.slice(previous.end, next.start);
  if (/\n/u.test(between) || /[!?。！？]/u.test(between)) {
    return true;
  }
  return /\./u.test(between) && !SENTENCE_SAFE_ABBREVIATIONS.has(previous.value);
}

function mergePickups(pickups: Pickup[], windowSeconds: number): Pickup[] {
  if (pickups.length < 2) {
    return pickups;
  }

  const mergeWindow = Number.isFinite(windowSeconds) ? Math.max(0, windowSeconds) : 0.4;

  const merged: Pickup[] = [];
  for (const pickup of pickups) {
    const previous = merged[merged.length - 1];
    if (
      !previous
      || previous.kind === "pause"
      || pickup.kind === "pause"
      || pickup.t_start - previous.t_end > mergeWindow
    ) {
      merged.push(pickup);
      continue;
    }

    const expected = [previous.expected, pickup.expected].filter(Boolean).join(" ");
    const heard = [previous.heard, pickup.heard].filter(Boolean).join(" ");
    const kind = expected && heard ? "sub" : expected ? "skip" : "insert";
    merged[merged.length - 1] = {
      ...previous,
      id: stablePickupId(
        previous.chapter_id,
        kind,
        expected,
        heard,
        previous.t_start,
        pickup.t_end,
        merged.length - 1,
      ),
      t_end: Math.max(previous.t_end, pickup.t_end),
      expected,
      heard,
      kind,
      confidence: Math.min(previous.confidence, pickup.confidence),
    };
  }
  return merged;
}

export interface TokenAlignment {
  tokenIndex: number;
  /** The manuscript word as written. */
  written: string;
  /** What the recogniser reported here, or "" when nothing was heard. */
  heard: string;
  start?: number;
  end?: number;
}

/**
 * Line every manuscript token up with what was heard there. The pickup list
 * only covers the places that disagreed, so a question like "did the narrator
 * say this name the same way each time" needs the matches too.
 */
export function alignManuscriptTokens(
  manuscript: string,
  transcript: TranscriptWord[],
): TokenAlignment[] {
  const tokens = tokenizeManuscript(manuscript);
  const words = transcript.filter((word) =>
    typeof word.text === "string" && normalizeToken(word.text).length > 0);
  const manuscriptUnits = manuscriptMatchUnits(tokens);
  const transcriptUnits = transcriptMatchUnits(words);
  const operations = diffTokens(
    manuscriptUnits.map((unit) => unit.key),
    transcriptUnits.map((unit) => unit.key),
  );

  const alignments: TokenAlignment[] = tokens.map((token) => ({
    tokenIndex: token.index,
    written: token.text,
    heard: "",
  }));

  // A hyphenated compound is matched piece by piece, so more than one match
  // unit can land on the same manuscript token.
  const assigned = new Set<number>();
  let index = 0;
  while (index < operations.length) {
    const operation = operations[index];
    if (operation.kind === "equal") {
      assign(
        manuscriptUnits[operation.manuscriptIndex],
        [transcriptUnits[operation.transcriptIndex]],
      );
      index += 1;
      continue;
    }

    // Gather the whole disagreement. A misread word is a delete beside an
    // insert, and the inserted words are what was actually said in place of the
    // deleted ones, which is the answer a pronunciation check needs.
    const deleted: MatchUnit[] = [];
    const inserted: MatchUnit[] = [];
    while (index < operations.length && operations[index].kind !== "equal") {
      const current = operations[index];
      if (current.kind === "delete") {
        deleted.push(manuscriptUnits[current.manuscriptIndex]);
      } else if (current.kind === "insert") {
        inserted.push(transcriptUnits[current.transcriptIndex]);
      }
      index += 1;
    }
    assignDisagreement(deleted, inserted);
  }

  return alignments;

  /**
   * Decide which spoken words stand in for which written ones inside a stretch
   * that disagreed. One word read as several, or several read as one, is a
   * plain substitution. A longer mismatch on both sides is garbled, and
   * guessing a pairing there would invent pronunciations that were never said,
   * so those tokens report nothing heard.
   */
  function assignDisagreement(deleted: MatchUnit[], inserted: MatchUnit[]): void {
    if (deleted.length === 0) {
      return;
    }
    if (inserted.length === 0 || deleted.length === 1 || inserted.length === 1) {
      for (const unit of deleted) {
        assign(unit, inserted);
      }
      return;
    }
    if (deleted.length === inserted.length) {
      deleted.forEach((unit, offset) => assign(unit, [inserted[offset]]));
      return;
    }
    for (const unit of deleted) {
      assign(unit, []);
    }
  }

  function assign(manuscriptUnit: MatchUnit | undefined, transcriptUnitList: Array<MatchUnit | undefined>): void {
    if (!manuscriptUnit) {
      return;
    }
    const heardWords = transcriptUnitList
      .filter((unit): unit is MatchUnit => unit !== undefined)
      .flatMap((unit) => words.slice(unit.from, unit.to + 1));
    const heard = heardWords.map((word) => word.text).join(" ");
    const start = heardWords[0]?.start;
    const end = heardWords[heardWords.length - 1]?.end;
    for (let token = manuscriptUnit.from; token <= manuscriptUnit.to; token += 1) {
      const alignment = alignments[token];
      if (!alignment) {
        continue;
      }
      if (assigned.has(token)) {
        // Each half of "half-empty" is matched on its own, so the second half
        // joins the first reading rather than replacing it.
        alignment.heard = [alignment.heard, heard].filter((part) => part !== "").join(" ");
        alignment.start = alignment.start ?? start;
        alignment.end = end ?? alignment.end;
        continue;
      }
      assigned.add(token);
      // A number spoken across several words covers several tokens at once, so
      // each of them reports the whole spoken figure.
      alignment.heard = heard;
      alignment.start = start;
      alignment.end = end;
    }
  }
}

/** Normalize the filter list the same way tokens are, so it matches them. */
export function normalizeSuppressedWords(words: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const word of words ?? []) {
    for (const piece of spokenPieces(word)) {
      set.add(piece);
    }
  }
  return set;
}

/**
 * A pickup is suppressed when every manuscript word in it is on the filter
 * list. Requiring all of them keeps a filtered word from hiding the real
 * problem beside it when nearby pickups were merged into one trip to the booth.
 */
export function isSuppressedPickup(
  pickup: Pick<Pickup, "expected" | "heard" | "kind">,
  suppressed: Set<string>,
): boolean {
  if (suppressed.size === 0 || pickup.kind === "pause") {
    return false;
  }
  const expected = spokenPieces(pickup.expected);
  if (expected.length > 0) {
    return expected.every((word) => suppressed.has(word));
  }
  // An insert has no manuscript side, so judge it by what was heard.
  const heard = spokenPieces(pickup.heard);
  return heard.length > 0 && heard.every((word) => suppressed.has(word));
}

function firstWordOfUnit(words: TranscriptWord[], unit: MatchUnit | undefined): TranscriptWord | undefined {
  return unit ? words[unit.from] : undefined;
}

function lastWordOfUnit(words: TranscriptWord[], unit: MatchUnit | undefined): TranscriptWord | undefined {
  return unit ? words[unit.to] : undefined;
}

function inferDuration(transcript: TranscriptWord[]): number {
  let duration = 0;
  for (const word of transcript) {
    duration = Math.max(duration, word.end);
  }
  return duration;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedConfidence(value: number | undefined): number {
  return Number.isFinite(value) ? clamp(value as number, 0, 1) : 0;
}

function stablePickupId(
  chapterId: string,
  kind: string,
  expected: string,
  heard: string,
  tStart: number,
  tEnd: number,
  ordinal: number,
): string {
  const input = `${chapterId}|${kind}|${expected}|${heard}|${tStart.toFixed(4)}|${tEnd.toFixed(4)}|${ordinal}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pickup-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function pickupSignature(pickup: Pickup): string {
  return `${pickup.kind}|${pickup.expected}|${pickup.heard}`;
}

function diffTokens(a: string[], b: string[]): DiffOperation[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const trace: Array<Map<number, number>> = [];
  let frontier = new Map<number, number>([[1, 0]]);
  let finished = false;

  for (let distance = 0; distance <= max && !finished; distance += 1) {
    trace.push(new Map(frontier));
    const next = new Map<number, number>();
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? 0;
      const right = (frontier.get(diagonal - 1) ?? -1) + 1;
      let x = diagonal === -distance || (diagonal !== distance && down > right) ? down : right;
      let y = x - diagonal;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      next.set(diagonal, x);
      if (x >= n && y >= m) {
        finished = true;
        break;
      }
    }
    frontier = next;
  }

  return backtrackDiff(trace, a, b);
}

function backtrackDiff(trace: Array<Map<number, number>>, a: string[], b: string[]): DiffOperation[] {
  const operations: DiffOperation[] = [];
  let x = a.length;
  let y = b.length;

  for (let distance = trace.length - 1; distance > 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = x - y;
    const down = frontier.get(diagonal + 1) ?? 0;
    const right = (frontier.get(diagonal - 1) ?? -1) + 1;
    const previousDiagonal = diagonal === -distance || (diagonal !== distance && down > right)
      ? diagonal + 1
      : diagonal - 1;
    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      operations.push({ kind: "equal", manuscriptIndex: x - 1, transcriptIndex: y - 1 });
      x -= 1;
      y -= 1;
    }

    if (x === previousX) {
      operations.push({ kind: "insert", transcriptIndex: y - 1 });
      y -= 1;
    } else {
      operations.push({ kind: "delete", manuscriptIndex: x - 1 });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    operations.push({ kind: "equal", manuscriptIndex: x - 1, transcriptIndex: y - 1 });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    operations.push({ kind: "delete", manuscriptIndex: x - 1 });
    x -= 1;
  }
  while (y > 0) {
    operations.push({ kind: "insert", transcriptIndex: y - 1 });
    y -= 1;
  }

  return operations.reverse();
}
