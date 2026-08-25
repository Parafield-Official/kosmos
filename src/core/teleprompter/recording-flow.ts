import type { TranscriptWord } from "../proof/align";
import { alignedManuscriptTokens } from "../proof/selection";

export type StoppedReadPrimaryAction = "start" | "continue";

export interface StoppedReadFlow {
  primary: StoppedReadPrimaryAction;
  primaryLabel: "Start narrating" | "Continue recording";
  canCheck: boolean;
  canStartOver: boolean;
  startOverRequiresConfirmation: boolean;
}

/** Keep one obvious primary action and make destructive replacement explicit. */
export function stoppedReadFlow(hasSavedTape: boolean): StoppedReadFlow {
  if (!hasSavedTape) {
    return {
      primary: "start",
      primaryLabel: "Start narrating",
      canCheck: false,
      canStartOver: false,
      startOverRequiresConfirmation: false,
    };
  }
  return {
    primary: "continue",
    primaryLabel: "Continue recording",
    canCheck: true,
    canStartOver: true,
    startOverRequiresConfirmation: true,
  };
}

/** Fraction of manuscript words with real timestamps in the selected recording. */
export function recordedManuscriptCoverage(
  manuscript: string,
  transcript: readonly TranscriptWord[],
): number {
  if (!manuscript.trim() || transcript.length === 0) {
    return 0;
  }
  const aligned = alignedManuscriptTokens(manuscript, [...transcript]);
  if (aligned.length === 0) {
    return 0;
  }
  const timed = aligned.filter((token) => Number.isFinite(token.start) && Number.isFinite(token.end)).length;
  return Math.min(1, Math.max(0, timed / aligned.length));
}
