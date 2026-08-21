import { alignTranscript, type TranscriptWord } from "./align";
import type { SilenceRange } from "./silence";

/**
 * A scored run of the aligner against a hand-labelled case. Precision matters
 * more than recall here: a narrator who is sent back to the booth for a pickup
 * that was never wrong stops trusting the list and stops reading it.
 */
export interface EvalCase {
  name: string;
  manuscript: string;
  /** What the recogniser reported, as `[text, start, end, confidence?]`. */
  heard: Array<[string, number, number] | [string, number, number, number]>;
  /** Manuscript words that genuinely need re-recording, lowercased. */
  expected: string[];
  /** Long pauses that should be reported, as second values. */
  expectedPauses?: number[];
  durationSeconds?: number;
  minConfidence?: number;
  pauseThresholdSeconds?: number;
  /** Quiet stretches as the audio measured them, when a case has any. */
  silences?: SilenceRange[];
}

export interface CaseResult {
  name: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Pickups raised that no label asked for, for reading a failure. */
  spurious: string[];
  missed: string[];
}

export interface EvalSummary {
  cases: CaseResult[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

export function runEvalCase(testCase: EvalCase): CaseResult {
  const transcript: TranscriptWord[] = testCase.heard.map(([text, start, end, confidence]) => ({
    text,
    start,
    end,
    ...(confidence === undefined ? {} : { confidence }),
  }));
  const result = alignTranscript({
    chapterId: "eval",
    manuscript: testCase.manuscript,
    transcript,
    durationSeconds: testCase.durationSeconds,
    minConfidence: testCase.minConfidence,
    pauseThresholdSeconds: testCase.pauseThresholdSeconds,
    silences: testCase.silences,
  });

  const wantedWords = testCase.expected.map((word) => word.toLowerCase());
  const wantedPauses = testCase.expectedPauses ?? [];
  const unmatchedWords = [...wantedWords];
  const unmatchedPauses = [...wantedPauses];
  const spurious: string[] = [];
  let truePositives = 0;

  for (const pickup of result.pickups) {
    if (pickup.kind === "pause") {
      const index = unmatchedPauses.findIndex((at) => Math.abs(at - pickup.t_start) <= 0.5);
      if (index >= 0) {
        unmatchedPauses.splice(index, 1);
        truePositives += 1;
      } else {
        spurious.push(`pause at ${pickup.t_start.toFixed(2)}s`);
      }
      continue;
    }
    // A pickup counts as found when it covers a labelled word, since the
    // aligner is free to group neighbouring problems into one trip to the booth.
    const covered = unmatchedWords.filter((word) => pickupMentions(pickup.expected, pickup.heard, word));
    if (covered.length === 0) {
      spurious.push(`${pickup.expected || "—"} → ${pickup.heard || "—"}`);
      continue;
    }
    for (const word of covered) {
      unmatchedWords.splice(unmatchedWords.indexOf(word), 1);
    }
    truePositives += covered.length;
  }

  return {
    name: testCase.name,
    truePositives,
    falsePositives: spurious.length,
    falseNegatives: unmatchedWords.length + unmatchedPauses.length,
    spurious,
    missed: [...unmatchedWords, ...unmatchedPauses.map((at) => `pause at ${at}s`)],
  };
}

export function runEvalSuite(cases: EvalCase[]): EvalSummary {
  const results = cases.map(runEvalCase);
  const truePositives = sum(results.map((result) => result.truePositives));
  const falsePositives = sum(results.map((result) => result.falsePositives));
  const falseNegatives = sum(results.map((result) => result.falseNegatives));
  return {
    cases: results,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
  };
}

function pickupMentions(expected: string, heard: string, word: string): boolean {
  const haystack = `${expected} ${heard}`.toLowerCase();
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}([^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** With nothing to find and nothing raised, the score is a clean 1. */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
