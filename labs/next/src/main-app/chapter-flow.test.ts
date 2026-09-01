import { describe, expect, it } from "vitest";
import { proofStepAction } from "./chapter-flow";
import type { BookChapter } from "./store";

function chapter(patch: Partial<BookChapter> = {}): BookChapter {
  return {
    id: "ch-test",
    title: "Test",
    wordCount: 10,
    recordedPct: 1,
    hasOriginalAudio: true,
    hasWorkingAudio: false,
    hasMasteredAudio: false,
    resumeWordIndex: 10,
    proofed: false,
    mastered: false,
    ...patch,
  };
}

describe("chapter Proofread step", () => {
  it("runs proofing when a complete take has not been proofed", () => {
    expect(proofStepAction(chapter())).toBe("run");
  });

  it("does not run proofing again after a real proof engine is recorded", () => {
    expect(proofStepAction(chapter({ proofed: true, proofTimingEngine: "whisperx" }))).toBe("navigate");
  });
});
