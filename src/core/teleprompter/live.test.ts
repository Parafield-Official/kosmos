import { describe, expect, it } from "vitest";
import { matchLiveWindow, type LiveExpectedWord } from "./live";

const expected: LiveExpectedWord[] = [
  { index: 0, lineIndex: 0, text: "The" },
  { index: 1, lineIndex: 0, text: "fox" },
  { index: 2, lineIndex: 0, text: "jumped" },
  { index: 3, lineIndex: 0, text: "in" },
  { index: 4, lineIndex: 0, text: "the" },
];

describe("teleprompter live matching", () => {
  it("advances only forward and ignores repeated rolling-window words", () => {
    const first = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "fox", start: 0.3, end: 0.5, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    const second = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "fox", start: 0.3, end: 0.5, confidence: 0.98 },
        { text: "jumped", start: 0.6, end: 0.9, confidence: 0.98 },
      ],
      state: first.state,
      flagsEnabled: true,
    });

    expect(first.state).toEqual({ cursor: 2, lastHeardEnd: 0.5 });
    expect(second.state).toEqual({ cursor: 3, lastHeardEnd: 0.9 });
    expect(second.flag).toBeUndefined();
  });

  it("emits a high-confidence full-word mismatch but hides low-confidence guesses", () => {
    const low = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hop", start: 0, end: 0.3, confidence: 0.89 }],
      state: { cursor: 2, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(low.flag).toBeUndefined();
    expect(low.state.cursor).toBe(2);

    const high = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hopped", start: 0.1, end: 0.4, confidence: 0.96 }],
      state: low.state,
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(high.flag).toMatchObject({ expected: "jumped", heard: "hopped", expectedIndex: 2 });
    expect(high.state.cursor).toBe(3);
  });

  it("never emits a dismissed line again", () => {
    const first = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hopped", start: 0.1, end: 0.4, confidence: 0.96 }],
      state: { cursor: 2, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    const repeated = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hopped", start: 0.1, end: 0.4, confidence: 0.96 }],
      state: { cursor: 2, lastHeardEnd: 0 },
      flagsEnabled: true,
      dismissedIds: [first.flag!.id],
    });
    expect(repeated.flag).toBeUndefined();
  });

  it("resynchronizes when narration starts after a skipped heading", () => {
    const headingAndBody: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "Leaflets" },
      { index: 1, lineIndex: 1, text: "At" },
      { index: 2, lineIndex: 1, text: "dusk" },
      { index: 3, lineIndex: 1, text: "they" },
      { index: 4, lineIndex: 1, text: "pour" },
    ];

    const result = matchLiveWindow({
      chapterId: "ch01",
      expected: headingAndBody,
      transcript: [
        { text: "At", start: 0, end: 0.2, confidence: 0.97 },
        { text: "dusk", start: 0.2, end: 0.5, confidence: 0.98 },
        { text: "they", start: 0.5, end: 0.8, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });

    expect(result.state.cursor).toBe(4);
    expect(result.flag).toBeUndefined();
  });

  it("rejoins after Whisper misses a word in the middle of a line", () => {
    const result = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "jumped", start: 0.3, end: 0.6, confidence: 0.98 },
        { text: "in", start: 0.7, end: 0.9, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });

    expect(result.state.cursor).toBe(4);
    expect(result.flag).toBeUndefined();
  });
});
