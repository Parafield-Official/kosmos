import { afterEach, describe, expect, it, vi } from "vitest";
import * as selection from "../../../../src/core/proof/selection";
import { createChapterPlaybackClock } from "./review-timing";
import type { BookChapter } from "./store";

const chapter = {
  id: "chapter", recordedWords: [
    { index: 0, start: 0, end: 0.9 }, { index: 1, start: 1, end: 1.9 }, { index: 2, start: 2, end: 2.9 },
  ],
} as BookChapter;
afterEach(() => vi.restoreAllMocks());

describe("chapter playback alignment cache", () => {
  it("aligns once across repeated timing updates and seeks in either direction", () => {
    const align = vi.spyOn(selection, "alignedManuscriptTokens");
    const clock = createChapterPlaybackClock();
    for (let i = 0; i < 200; i++) {
      const index = i % 3;
      expect(clock("One two three", chapter, "original", index + 0.1)).toBe(index);
    }
    expect(align).toHaveBeenCalledTimes(1);
    clock("One two three", { ...chapter, title: "Renamed" }, "original", 1);
    expect(align).toHaveBeenCalledTimes(1);
  });

  it("keeps original and punched working timelines separate", () => {
    const align = vi.spyOn(selection, "alignedManuscriptTokens");
    const clock = createChapterPlaybackClock();
    clock("One two three", chapter, "original", 2.1);
    clock("One two three", chapter, "working", 2.1);
    const edited = { ...chapter, punches: [{ t_start: 1, t_end: 2, durationDelta: 2 }] } as BookChapter;
    expect(clock("One two three", edited, "working", 4.1)).toBe(2);
    expect(clock("One two three", edited, "original", 2.1)).toBe(2);
    expect(align).toHaveBeenCalledTimes(3);
  });

  it("invalidates on new timings, manuscript edits, and chapter changes", () => {
    const align = vi.spyOn(selection, "alignedManuscriptTokens");
    const clock = createChapterPlaybackClock();
    clock("One two three", chapter, "original", 1.1);
    const updated = { ...chapter, recordedWords: chapter.recordedWords!.map(word => ({ ...word, start: word.start + 10, end: word.end + 10 })) };
    expect(clock("One two three", updated, "original", 11.1)).toBe(1);
    clock("One two THREE!", updated, "original", 11.1);
    clock("One two THREE!", { ...updated, id: "next" }, "original", 11.1);
    expect(align).toHaveBeenCalledTimes(4);
  });

  it("invalidates when proofing replaces recorded-word timing", () => {
    const clock = createChapterPlaybackClock();
    expect(clock("One two three", chapter, "original", 1.1)).toBe(1);
    const proofed = { ...chapter, proofTranscript: [
      { text: "One", start: 0, end: 2 }, { text: "two", start: 2, end: 4 }, { text: "three", start: 4, end: 6 },
    ] };
    expect(clock("One two three", proofed, "original", 1.1)).toBe(0);
    expect(clock("One two three", proofed, "original", 4.1)).toBe(2);
  });
});
