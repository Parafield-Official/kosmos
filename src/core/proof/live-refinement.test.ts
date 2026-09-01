import { describe, expect, it } from "vitest";
import { refineLiveManuscriptTimeline } from "./live-refinement";

describe("refineLiveManuscriptTimeline", () => {
  const manuscript = "At dusk they pour from the sky.";
  const baseline = [
    { text: "At", start: 2.30, end: 2.55 },
    { text: "dusk", start: 2.55, end: 3.10 },
    { text: "they", start: 3.40, end: 3.80 },
    { text: "pour", start: 3.80, end: 4.25 },
    { text: "from", start: 4.25, end: 4.70 },
    { text: "the", start: 4.85, end: 5.10 },
    { text: "sky", start: 5.10, end: 5.55 },
  ];

  it("uses post-recording boundaries without changing manuscript text", () => {
    const result = refineLiveManuscriptTimeline({
      manuscript,
      baseline,
      aligned: [
        { text: "At", start: 2.41, end: 2.54 },
        { text: "dusk", start: 2.60, end: 3.02 },
        { text: "they", start: 3.46, end: 3.72 },
        { text: "pour", start: 3.82, end: 4.16 },
        { text: "from", start: 4.28, end: 4.57 },
        { text: "the", start: 4.91, end: 5.04 },
        { text: "sky", start: 5.13, end: 5.43 },
      ],
    });

    expect(result.adopted).toBe(true);
    expect(result.coverage).toBe(1);
    expect(result.timeline.map((word) => word.text)).toEqual([
      "At", "dusk", "they", "pour", "from", "the", "sky",
    ]);
    expect(result.timeline[0]).toMatchObject({ text: "At", start: 2.41, end: 2.54 });
    expect(result.timeline.at(-1)).toMatchObject({ text: "sky", start: 5.13, end: 5.43 });
  });

  it("keeps canonical spelling for a one-word misread while accepting its timing", () => {
    const result = refineLiveManuscriptTimeline({
      manuscript,
      baseline,
      aligned: baseline.map((word) => word.text === "dusk"
        ? { ...word, text: "dust", start: 2.62, end: 3.01 }
        : word),
    });

    expect(result.adopted).toBe(true);
    expect(result.timeline[1]).toMatchObject({ text: "dusk", start: 2.62, end: 3.01 });
    expect(result.timeline.some((word) => word.text === "dust")).toBe(false);
  });

  it("falls back per word when alignment misses a manuscript word", () => {
    const aligned = baseline
      .filter((word) => word.text !== "pour")
      .map((word) => ({ ...word, start: word.start + 0.1, end: word.end - 0.05 }));
    const result = refineLiveManuscriptTimeline({ manuscript, baseline, aligned });

    expect(result.adopted).toBe(true);
    expect(result.timeline.find((word) => word.text === "pour")).toEqual(baseline[3]);
    expect(result.refinedWordCount).toBe(6);
  });

  it("rejects sparse timing instead of degrading the in-app clock", () => {
    const result = refineLiveManuscriptTimeline({
      manuscript,
      baseline,
      aligned: baseline.slice(0, 2),
      minimumCoverage: 0.8,
    });

    expect(result.adopted).toBe(false);
    expect(result.timeline).toEqual(baseline);
  });

  it("does not insert words that are absent from the manuscript", () => {
    const result = refineLiveManuscriptTimeline({
      manuscript,
      baseline,
      aligned: [
        ...baseline.slice(0, 2),
        { text: "actually", start: 3.11, end: 3.30 },
        ...baseline.slice(2),
      ],
    });

    expect(result.timeline).toHaveLength(7);
    expect(result.timeline.some((word) => word.text === "actually")).toBe(false);
  });
});
