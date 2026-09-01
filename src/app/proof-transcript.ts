export type ProofTranscriptOrigin = "generated" | "manual";

export interface ProofTranscriptChoice {
  text: string;
  origin: ProofTranscriptOrigin;
  preferLive: boolean;
}

/**
 * Only explicit human edits are text-only proof inputs. ASR text is displayed
 * in the same box, but synthesizing evenly spaced times from it discards the
 * word timestamps and makes listen-back drift. A fresh booth read must always
 * be timed from that recording, even if the box still contains a manual edit.
 */
export function shouldUseTranscriptOverride(input: ProofTranscriptChoice): boolean {
  return !input.preferLive
    && input.origin === "manual"
    && input.text.trim().length > 0;
}
