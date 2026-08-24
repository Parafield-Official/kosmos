import { describe, expect, it } from "vitest";
import type { ScriptSpan } from "../project/types";
import { applyPerformanceCue, nextPerformanceCueByRows, performanceCuesFromSpans } from "./performance-cues";

const spans: ScriptSpan[] = [{
  text: "Mara opened the letter, then waited.",
  seat: "narration",
  style: [],
}];

describe("inline narrator performance cues", () => {
  it("anchors a cue to one manuscript word without changing the text", () => {
    const next = applyPerformanceCue(spans, 1, { kind: "character", label: "Mara — guarded" });
    expect(next.map((span) => span.text).join("")).toBe(spans[0]!.text);
    expect(next.find((span) => span.performance_cue)?.text).toBe("opened");
    expect(next.find((span) => span.performance_cue)?.performance_cue).toEqual({
      kind: "character",
      label: "Mara — guarded",
    });
  });

  it("replaces and removes a cue while merging compatible spans again", () => {
    const marked = applyPerformanceCue(spans, 3, { kind: "breath" });
    const replaced = applyPerformanceCue(marked, 3, { kind: "beat", label: "Let this land" });
    expect(performanceCuesFromSpans(replaced)).toMatchObject([{
      wordIndex: 3,
      lineIndex: 0,
      cue: { kind: "beat", label: "Let this land" },
    }]);
    expect(applyPerformanceCue(replaced, 3, null)).toEqual(spans);
  });

  it("tracks cue indexes across paragraph breaks and styled spans", () => {
    const chapter: ScriptSpan[] = [
      { text: "First line.\n", seat: "narration", style: ["italic"] },
      { text: "Second line", seat: "narration", style: [], performance_cue: { kind: "emphasis" } },
    ];
    expect(performanceCuesFromSpans(chapter)).toEqual([
      { id: "cue-2", wordIndex: 2, lineIndex: 1, cue: { kind: "emphasis" } },
      { id: "cue-3", wordIndex: 3, lineIndex: 1, cue: { kind: "emphasis" } },
    ]);
  });

  it("surfaces the next cue no more than two visible rows ahead", () => {
    const cues = [
      { id: "cue-2", wordIndex: 2, lineIndex: 0, cue: { kind: "beat" as const } },
      { id: "cue-5", wordIndex: 5, lineIndex: 1, cue: { kind: "breath" as const } },
    ];
    const tops = [10, 10, 30, 30, 50, 70];

    expect(nextPerformanceCueByRows(cues, 0, tops)).toEqual({ cue: cues[0], rowsAhead: 1 });
    expect(nextPerformanceCueByRows(cues, 3, tops)).toEqual({ cue: cues[1], rowsAhead: 2 });
    expect(nextPerformanceCueByRows(cues, 6, tops)).toBeNull();
  });
});
