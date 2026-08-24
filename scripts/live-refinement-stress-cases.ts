import type { TranscriptWord } from "../src/core/proof/align";
import { tokenizeManuscript } from "../src/core/proof/normalize";

export type CutoffPattern = "exact" | "early" | "late" | "clipped-head" | "clipped-tail" | "wide";

export interface CutoffCase {
  start: number;
  length: number;
  pattern: CutoffPattern;
  startDelta: number;
  endDelta: number;
}

const PATTERNS: Array<Pick<CutoffCase, "pattern" | "startDelta" | "endDelta">> = [
  { pattern: "exact", startDelta: 0, endDelta: 0 },
  { pattern: "early", startDelta: -0.18, endDelta: -0.06 },
  { pattern: "late", startDelta: 0.08, endDelta: 0.18 },
  { pattern: "clipped-head", startDelta: 0.12, endDelta: 0 },
  { pattern: "clipped-tail", startDelta: 0, endDelta: -0.12 },
  { pattern: "wide", startDelta: -0.22, endDelta: 0.24 },
];
const LENGTHS = [1, 2, 4, 7, 11];

export function buildCutoffCases(wordCount: number, count = 30): CutoffCase[] {
  if (wordCount < 16 || count < 1) {
    return [];
  }
  const cases: CutoffCase[] = [];
  const usable = wordCount - Math.max(...LENGTHS) - 2;
  for (let index = 0; index < count; index += 1) {
    const pattern = PATTERNS[index % PATTERNS.length];
    const length = LENGTHS[index % LENGTHS.length];
    // A deterministic low-discrepancy walk avoids repeatedly sampling the
    // same sentence positions while keeping benchmark runs reproducible.
    const fraction = (index * 0.6180339887498949) % 1;
    const start = 1 + Math.floor(fraction * usable);
    cases.push({ start, length, ...pattern });
  }
  return cases;
}

/** Simulate the coarse manuscript clock available before post-recording alignment. */
export function buildApproximateClock(manuscript: string, durationSeconds: number): TranscriptWord[] {
  const tokens = tokenizeManuscript(manuscript);
  if (tokens.length === 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [];
  }
  const weights = tokens.map((token) => Math.max(1, token.text.length ** 0.72));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return tokens.map((token, index) => {
    const start = cursor;
    cursor = index === tokens.length - 1
      ? durationSeconds
      : cursor + durationSeconds * (weights[index] / total);
    return { text: token.text, start, end: cursor, confidence: 1 };
  });
}
