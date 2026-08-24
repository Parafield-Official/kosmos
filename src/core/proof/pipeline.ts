import type { ProofSourceKind } from "../teleprompter/session-tape";

export type ProofTimingPipeline = "manuscript-clock" | "forced-alignment";
export type ProofTimingEngine = "manuscript-clock" | "whisperx" | "whisper.cpp" | "manual";

/**
 * Booth reads already carry the manuscript clock captured during narration.
 * Only brought-in audio needs speech recognition plus forced word alignment.
 */
export function proofTimingPipeline(sourceKind: ProofSourceKind): ProofTimingPipeline {
  return sourceKind === "live" ? "manuscript-clock" : "forced-alignment";
}
