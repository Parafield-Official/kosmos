import type { TranscriptWord } from "../../../../src/core/proof/align";
import { buildNarrationRedoRanges } from "../../../../src/core/proof/selection";
import type { ChapterPickup } from "./store";

export type PunchScope = "sentence" | "paragraph";

/** Widen a word-level flag to the sentence or paragraph the narrator will re-record. */
export function expandPickupToScope(
  pickup: ChapterPickup,
  manuscript: string,
  transcript: TranscriptWord[],
  scope: PunchScope,
): ChapterPickup {
  const token = pickup.manuscript_index;
  if (typeof token !== "number" || !manuscript.trim() || transcript.length === 0) {
    return { ...pickup, selection_kind: scope };
  }
  try {
    const ranges = buildNarrationRedoRanges({
      manuscript,
      transcript,
      fromToken: token,
      toToken: token,
    });
    const range = scope === "paragraph" ? ranges.paragraph : ranges.sentence;
    if (
      range.timing === "unavailable" ||
      range.start === undefined ||
      range.end === undefined ||
      range.end <= range.start
    ) {
      return { ...pickup, selection_kind: scope };
    }
    return {
      ...pickup,
      t_start: range.start,
      t_end: range.end,
      line_start: range.start,
      line_end: range.end,
      line_text: range.text,
      selection_kind: scope,
      manuscript_index: range.fromToken,
    };
  } catch {
    return { ...pickup, selection_kind: scope };
  }
}

export function punchTokenSpan(pickup: ChapterPickup, manuscript: string, transcript: TranscriptWord[]): {
  from: number;
  to: number;
} | null {
  const token = pickup.manuscript_index;
  if (typeof token !== "number") {
    return null;
  }
  const scope = pickup.selection_kind === "paragraph" ? "paragraph" : "sentence";
  try {
    const ranges = buildNarrationRedoRanges({
      manuscript,
      transcript,
      fromToken: token,
      toToken: token,
    });
    const range = scope === "paragraph" ? ranges.paragraph : ranges.sentence;
    return { from: range.fromToken, to: range.toToken };
  } catch {
    return { from: token, to: token };
  }
}
