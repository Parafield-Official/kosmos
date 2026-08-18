import type { Pickup, Seat } from "../project/types";
import { normalizeToken, tokenizeManuscript, type ManuscriptToken } from "./normalize";

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
}

/**
 * Compare a manuscript against word-timestamped ASR output. The ASR engine is
 * intentionally an input boundary: this function is deterministic and never
 * calls a cloud service or guesses whether a read is "good".
 */
export function alignTranscript(input: AlignTranscriptInput): AlignmentResult {
  const manuscriptTokens = tokenizeManuscript(input.manuscript);
  const transcriptWords = input.transcript.filter((word) =>
    typeof word.text === "string"
    && normalizeToken(word.text).length > 0
    && Number.isFinite(word.start)
    && Number.isFinite(word.end)
    && word.end >= word.start,
  );
  const transcriptValues = transcriptWords.map((word) => normalizeToken(word.text));
  const manuscriptValues = manuscriptTokens.map((token) => token.value);
  const operations = diffTokens(manuscriptValues, transcriptValues);
  const pickups: Pickup[] = [];
  let operationIndex = 0;
  let pickupOrdinal = 0;
  let previousTranscript: TranscriptWord | undefined;
  const durationSeconds = Number.isFinite(input.durationSeconds) && (input.durationSeconds ?? 0) >= 0
    ? input.durationSeconds as number
    : inferDuration(transcriptWords);

  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];
    if (operation.kind === "equal") {
      previousTranscript = transcriptWords[operation.transcriptIndex];
      operationIndex += 1;
      continue;
    }

    const run: PickupRun = { manuscript: [], transcript: [], previousTranscript };
    while (operationIndex < operations.length && operations[operationIndex].kind !== "equal") {
      const current = operations[operationIndex];
      if (current.kind === "delete") {
        run.manuscript.push(manuscriptTokens[current.manuscriptIndex]);
      } else {
        run.transcript.push({
          ...transcriptWords[current.transcriptIndex],
          index: current.transcriptIndex,
        });
      }
      operationIndex += 1;
    }

    const next = operations[operationIndex];
    if (next?.kind === "equal") {
      run.nextTranscript = transcriptWords[next.transcriptIndex];
    }

    const pickup = runToPickup(
      run,
      input.chapterId,
      durationSeconds,
      input.seat ?? "narration",
      pickupOrdinal,
    );
    if (pickup) {
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
    thresholdSeconds: input.pauseThresholdSeconds ?? 4,
    seat: input.seat ?? "narration",
    durationSeconds,
    startOrdinal: pickupOrdinal,
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
  thresholdSeconds: number;
  seat: Seat;
  durationSeconds: number;
  startOrdinal: number;
}

/** Detect only long, mid-sentence gaps; normal breaths and paragraph breaks stay quiet. */
function detectPausePickups(input: PauseDetectionInput): Pickup[] {
  const threshold = Number.isFinite(input.thresholdSeconds)
    ? Math.max(0, input.thresholdSeconds)
    : 4;
  if (threshold <= 0 || input.transcriptWords.length < 2) {
    return [];
  }

  const manuscriptByTranscript = new Map<number, number>();
  for (const operation of input.operations) {
    if (operation.kind === "equal") {
      manuscriptByTranscript.set(operation.transcriptIndex, operation.manuscriptIndex);
    }
  }

  const pauses: Pickup[] = [];
  for (let index = 0; index < input.transcriptWords.length - 1; index += 1) {
    const previous = input.transcriptWords[index];
    const next = input.transcriptWords[index + 1];
    const gap = next.start - previous.end;
    if (!Number.isFinite(gap) || gap <= threshold) {
      continue;
    }
    const previousManuscriptIndex = manuscriptByTranscript.get(index);
    const nextManuscriptIndex = manuscriptByTranscript.get(index + 1);
    if (
      previousManuscriptIndex === undefined
      || nextManuscriptIndex === undefined
      || nextManuscriptIndex !== previousManuscriptIndex + 1
    ) {
      // A non-adjacent pair usually means the reader skipped or inserted text;
      // the word pickup already explains that interval.
      continue;
    }
    const previousToken = input.manuscriptTokens[previousManuscriptIndex];
    const nextToken = input.manuscriptTokens[nextManuscriptIndex];
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
        previous.end,
        next.start,
        input.startOrdinal + pauses.length,
      ),
      chapter_id: input.chapterId,
      t_start: Math.max(0, previous.end),
      t_end: Math.max(Math.max(0, previous.end), next.start),
      expected: `Pause > ${threshold}s`,
      heard: "",
      kind: "pause",
      seat: input.seat,
      status: "open",
      confidence: clamp(confidence, 0, 1),
    });
  }
  return pauses;
}

function runToPickup(
  run: PickupRun,
  chapterId: string,
  durationSeconds: number,
  seat: Seat,
  ordinal: number,
): Pickup | null {
  const expected = run.manuscript.map((token) => token.text).join(" ");
  const heard = run.transcript.map((word) => word.text).join(" ");
  if (expected.length === 0 && heard.length === 0) {
    return null;
  }

  const kind = expected && heard ? "sub" : expected ? "skip" : "insert";
  const tStart = run.transcript.length > 0
    ? Math.min(...run.transcript.map((word) => word.start))
    : run.previousTranscript?.end ?? 0;
  const tEnd = run.transcript.length > 0
    ? Math.max(...run.transcript.map((word) => word.end))
    : run.nextTranscript?.start ?? durationSeconds;
  const confidence = run.transcript.length > 0
    ? average(run.transcript.map((word) => clamp(word.confidence ?? 0, 0, 1)))
    : 0;

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
  };
}

function mergePickups(pickups: Pickup[], windowSeconds: number): Pickup[] {
  if (pickups.length < 2) {
    return pickups;
  }

  const mergeWindow = Number.isFinite(windowSeconds) ? Math.max(0, windowSeconds) : 0.4;

  const merged: Pickup[] = [];
  for (const pickup of pickups) {
    const previous = merged[merged.length - 1];
    if (!previous || pickup.t_start - previous.t_end > mergeWindow) {
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

function inferDuration(transcript: TranscriptWord[]): number {
  return transcript.length === 0 ? 0 : Math.max(...transcript.map((word) => word.end));
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
