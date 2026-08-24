import { describe, expect, it } from "vitest";
import { buildApproximateClock, buildCutoffCases } from "../../../scripts/live-refinement-stress-cases";

describe("live refinement stress cases", () => {
  it("covers early, late, clipped, wide, and exact boundaries at varied lengths", () => {
    const cases = buildCutoffCases(240, 25);

    expect(cases).toHaveLength(25);
    expect(new Set(cases.map((entry) => entry.pattern))).toEqual(new Set([
      "exact", "early", "late", "clipped-head", "clipped-tail", "wide",
    ]));
    expect(new Set(cases.map((entry) => entry.length))).toEqual(new Set([1, 2, 4, 7, 11]));
    expect(cases.every((entry) => entry.start > 0 && entry.start + entry.length < 240)).toBe(true);
  });

  it("builds a monotonic manuscript-only clock for unseen synthetic narration", () => {
    const timeline = buildApproximateClock(
      "Quartz clocks tick; seven silver aircraft circle Johannesburg twice.",
      8.4,
    );

    expect(timeline.map((word) => word.text)).toEqual([
      "Quartz", "clocks", "tick", "seven", "silver", "aircraft", "circle", "Johannesburg", "twice",
    ]);
    expect(timeline[0].start).toBe(0);
    expect(timeline.at(-1)?.end).toBeCloseTo(8.4, 5);
    expect(timeline.every((word, index) => index === 0 || word.start >= timeline[index - 1].end)).toBe(true);
  });
});
