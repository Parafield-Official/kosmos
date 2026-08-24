import type { TranscriptWord } from "./align";
import {
  manuscriptMatchUnits,
  tokenizeManuscript,
  transcriptMatchUnits,
  type MatchUnit,
} from "./normalize";

export type PickupVerificationStatus = "match" | "mismatch" | "inconclusive";

export interface PickupVerification {
  status: PickupVerificationStatus;
  title: string;
  detail: string;
  expectedExcerpt?: string;
  heardExcerpt?: string;
}

export interface PickupVerificationInput {
  manuscript: string;
  transcript: TranscriptWord[];
  minMismatchConfidence?: number;
}

export interface PickupProofComparison {
  editStatus: "applied" | "reverted";
  verificationStatus: "needs_verification" | "verified";
}

const DEFAULT_MIN_MISMATCH_CONFIDENCE = 0.55;
const MAX_EXCERPT_WORDS = 6;

/**
 * Compare one newly recorded pickup with the canonical manuscript passage.
 * The full recognizer transcript deliberately never leaves this boundary:
 * callers receive only a compact difference that helps a narrator decide
 * whether to listen again or record another take.
 */
export function verifyPickupTranscript(input: PickupVerificationInput): PickupVerification {
  const manuscriptTokens = tokenizeManuscript(input.manuscript);
  const transcript = input.transcript.filter((word) => word.text.trim().length > 0);
  if (manuscriptTokens.length === 0 || transcript.length === 0) {
    return inconclusiveResult();
  }

  const expectedUnits = manuscriptMatchUnits(manuscriptTokens);
  const heardUnits = transcriptMatchUnits(transcript);
  if (sameKeys(expectedUnits, heardUnits)) {
    return {
      status: "match",
      title: "Words match manuscript",
      detail: "The pickup’s words match the selected passage. Listen in context for performance and the edit join.",
    };
  }

  const knownConfidence = transcript
    .map((word) => word.confidence)
    .filter((confidence): confidence is number => Number.isFinite(confidence));
  const averageConfidence = knownConfidence.length > 0
    ? knownConfidence.reduce((sum, confidence) => sum + confidence, 0) / knownConfidence.length
    : undefined;
  if (
    averageConfidence !== undefined
    && averageConfidence < (input.minMismatchConfidence ?? DEFAULT_MIN_MISMATCH_CONFIDENCE)
  ) {
    return inconclusiveResult();
  }

  const difference = differenceBounds(expectedUnits, heardUnits);
  const expectedExcerpt = unitExcerpt(
    manuscriptTokens.map((token) => token.text),
    expectedUnits,
    difference.expectedFrom,
    difference.expectedTo,
  );
  const heardExcerpt = unitExcerpt(
    transcript.map((word) => word.text),
    heardUnits,
    difference.heardFrom,
    difference.heardTo,
  );

  return {
    status: "mismatch",
    title: "Check the wording",
    detail: `Expected “${expectedExcerpt || "nothing"}”; the word check heard “${heardExcerpt || "nothing"}”. Listen before deciding.`,
    expectedExcerpt,
    heardExcerpt,
  };
}

export function finalPickupProofReadiness(comparisons: readonly PickupProofComparison[]): {
  ready: boolean;
  label: string;
} {
  const applied = comparisons.filter((comparison) => comparison.editStatus === "applied");
  if (applied.length === 0) {
    return { ready: false, label: "No applied pickups" };
  }
  const unverified = applied.filter((comparison) => comparison.verificationStatus === "needs_verification").length;
  if (unverified > 0) {
    return {
      ready: false,
      label: `Verify ${unverified} edited ${unverified === 1 ? "join" : "joins"} first`,
    };
  }
  return { ready: true, label: "Run final chapter check" };
}

function inconclusiveResult(): PickupVerification {
  return {
    status: "inconclusive",
    title: "Couldn’t verify the words",
    detail: "The word check was not confident enough. Listen in context; you can record again or apply deliberately.",
  };
}

function sameKeys(left: readonly MatchUnit[], right: readonly MatchUnit[]): boolean {
  return left.length === right.length && left.every((unit, index) => unit.key === right[index]?.key);
}

function differenceBounds(expected: readonly MatchUnit[], heard: readonly MatchUnit[]): {
  expectedFrom: number;
  expectedTo: number;
  heardFrom: number;
  heardTo: number;
} {
  let prefix = 0;
  while (prefix < expected.length && prefix < heard.length && expected[prefix].key === heard[prefix].key) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < expected.length - prefix
    && suffix < heard.length - prefix
    && expected[expected.length - 1 - suffix].key === heard[heard.length - 1 - suffix].key
  ) {
    suffix += 1;
  }
  return {
    expectedFrom: prefix,
    expectedTo: expected.length - suffix - 1,
    heardFrom: prefix,
    heardTo: heard.length - suffix - 1,
  };
}

function unitExcerpt(
  source: readonly string[],
  units: readonly MatchUnit[],
  fromUnit: number,
  toUnit: number,
): string {
  if (fromUnit < 0 || toUnit < fromUnit || fromUnit >= units.length) {
    return "";
  }
  const from = units[fromUnit].from;
  const to = units[Math.min(toUnit, units.length - 1)].to;
  const excerpt = source.slice(from, Math.min(to + 1, from + MAX_EXCERPT_WORDS));
  return `${excerpt.join(" ")}${to - from + 1 > MAX_EXCERPT_WORDS ? "…" : ""}`;
}
