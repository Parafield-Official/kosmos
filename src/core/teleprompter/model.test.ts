import { describe, expect, it } from "vitest";
import {
  bookDashboardStats,
  buildPromptLines,
  clampFontSize,
  createLiveFlagsState,
  dismissLiveFlag,
  filterPromptChapters,
  promptChapterStatus,
  readingProgress,
  recordLiveFlag,
  relevantPromptGlossary,
  remainingReadTimeLabel,
  teleprompterLayout,
  type PromptSegment,
} from "./model";
import type { ChapterFile, GlossaryEntry } from "../project/types";

describe("teleprompter model", () => {
  it("keeps styles, seats, glossary links, and manual line breaks", () => {
    const spans: PromptSegment[] = [
      { text: "Elena", seat: "N1", style: ["italic"], glossary_id: "elena" },
      { text: " walked.\n", seat: "N1", style: [], },
      { text: "Kael", seat: "N2", style: ["bold", "highlight"], glossary_id: "kael" },
    ];

    const lines = buildPromptLines(spans);

    expect(lines.map((line) => line.text)).toEqual(["Elena walked.", "Kael"]);
    expect(lines[0].segments[0]).toMatchObject({ text: "Elena", seat: "N1", glossary_id: "elena" });
    expect(lines[0].segments[0].style).toEqual(["italic"]);
    expect(lines[1].segments[0]).toMatchObject({ text: "Kael", seat: "N2", glossary_id: "kael" });
  });

  it("preserves intentional blank paragraphs instead of collapsing them", () => {
    const lines = buildPromptLines([
      { text: "first\n\nsecond", seat: "narration", style: [] },
    ]);

    expect(lines.map((line) => line.text)).toEqual(["first", "", "second"]);
  });

  it("hides Markdown heading markers from existing teleprompter documents", () => {
    const lines = buildPromptLines([
      { text: "# Chapter 1\n## Scene", seat: "narration", style: [] },
    ]);

    expect(lines.map((line) => line.text)).not.toEqual(expect.arrayContaining([
      expect.stringContaining("#"),
    ]));
    expect(lines.map((line) => line.text)).toEqual([
      expect.stringContaining("Chapter 1"),
      expect.stringContaining("Scene"),
    ]);
    expect(lines.flatMap((line) => line.segments).map((segment) => segment.text).join("")).not.toContain("#");
  });

  it("does not merge dialogue and narration segments when their visual style matches", () => {
    const lines = buildPromptLines([
      { text: "Before ", seat: "narration", style: [] },
      { text: "spoken", seat: "narration", style: [], dialogue: true },
      { text: " after", seat: "narration", style: [] },
    ]);

    expect(lines[0].segments).toEqual([
      expect.objectContaining({ text: "Before " }),
      expect.objectContaining({ text: "spoken", dialogue: true }),
      expect.objectContaining({ text: " after" }),
    ]);
    expect(lines[0].segments[0]).not.toHaveProperty("dialogue");
    expect(lines[0].segments[2]).not.toHaveProperty("dialogue");
  });

  it("clamps readable font sizes", () => {
    expect(clampFontSize(4)).toBe(20);
    expect(clampFontSize(48)).toBe(48);
    expect(clampFontSize(200)).toBe(96);
  });

  it("keeps live flags off by default and auto-dims after three false alarms", () => {
    let state = createLiveFlagsState();
    expect(state.enabled).toBe(false);
    state = { ...state, enabled: true };
    state = recordLiveFlag(state, { id: "a", isTrueMismatch: false });
    state = recordLiveFlag(state, { id: "b", isTrueMismatch: false });
    state = recordLiveFlag(state, { id: "c", isTrueMismatch: false });
    expect(state.dimmed).toBe(true);
    expect(state.falseAlarmCount).toBe(3);
    state = dismissLiveFlag(state, "a");
    expect(state.dismissedIds).toContain("a");
  });

  it("counts user-dismissed flags toward the three-false-alarm safety limit", () => {
    let state = { ...createLiveFlagsState(), enabled: true };
    state = dismissLiveFlag(state, "a");
    state = dismissLiveFlag(state, "b");
    state = dismissLiveFlag(state, "c");

    expect(state.dismissedIds).toEqual(["a", "b", "c"]);
    expect(state.falseAlarmCount).toBe(3);
    expect(state.dimmed).toBe(true);
  });

  it("summarizes an uploaded book for the dashboard", () => {
    const chapters: ChapterFile[] = [
      chapter({ id: "two", index: 2, word_count: 1_550, estimated_duration_minutes: 10, audio_path: "audio/02.wav", open_pickups: 2 }),
      chapter({ id: "one", index: 1, word_count: 775, audio_path: "audio/01.wav", open_pickups: 0, acx_traffic_light: "green" }),
      chapter({ id: "three", index: 3, word_count: 775 }),
    ];

    expect(bookDashboardStats(chapters)).toEqual({
      chapterCount: 3,
      wordCount: 3_100,
      estimatedMinutes: 20,
      recordedCount: 2,
      proofedCount: 1,
      openPickups: 2,
    });
  });

  it("filters chapters by title or padded chapter number and keeps book order", () => {
    const chapters = [
      chapter({ id: "three", index: 3, title: "Come Away" }),
      chapter({ id: "one", index: 1, title: "Tutorial" }),
      chapter({ id: "two", index: 2, title: "The Shadow" }),
    ];

    expect(filterPromptChapters(chapters, "shadow").map((item) => item.id)).toEqual(["two"]);
    expect(filterPromptChapters(chapters, "02").map((item) => item.id)).toEqual(["two"]);
    expect(filterPromptChapters(chapters, "").map((item) => item.id)).toEqual(["one", "two", "three"]);
  });

  it("gives chapters plain-language recording and proofing states", () => {
    expect(promptChapterStatus(chapter({}))).toEqual({ label: "Needs recording", tone: "idle" });
    expect(promptChapterStatus(chapter({ audio_path: "audio/01.wav" }))).toEqual({ label: "Recorded", tone: "recorded" });
    expect(promptChapterStatus(chapter({ audio_path: "audio/01.wav", open_pickups: 2 }))).toEqual({ label: "2 pickups", tone: "review" });
    expect(promptChapterStatus(chapter({ audio_path: "audio/01.wav", open_pickups: 0 }))).toEqual({ label: "Proofed", tone: "ready" });
  });

  it("keeps materials scoped to words used by the current chapter", () => {
    const glossary: GlossaryEntry[] = [
      { id: "elena", spelling: "Elena", respell: "eh-LAY-nah", frequency: 2, source: "auto" },
      { id: "kael", spelling: "Kael", frequency: 1, source: "user" },
      { id: "unused", spelling: "Elsewhere", frequency: 4, source: "auto" },
    ];
    const spans: PromptSegment[] = [
      { text: "Elena crossed the bridge. ", seat: "N1", style: [], glossary_id: "elena" },
      { text: "Kael followed.", seat: "N2", style: [] },
    ];

    expect(relevantPromptGlossary(spans, glossary).map((entry) => entry.id)).toEqual(["elena", "kael"]);
  });

  it("turns scroll position into bounded progress and honest time remaining", () => {
    expect(readingProgress(300, 1_000, 400)).toBe(0.5);
    expect(readingProgress(-50, 1_000, 400)).toBe(0);
    expect(readingProgress(2_000, 1_000, 400)).toBe(1);
    expect(readingProgress(50, 500, 500)).toBe(1);
    expect(remainingReadTimeLabel(12, 0.25)).toBe("9m left");
    expect(remainingReadTimeLabel(1, 0.7)).toBe("Under a minute");
    expect(remainingReadTimeLabel(12, 1)).toBe("Chapter complete");
  });

  it("keeps the teleprompter in the current app view and frees reading space", () => {
    expect(teleprompterLayout(true)).toEqual({
      teleprompterOpen: true,
      studioNavOpen: false,
    });
    expect(teleprompterLayout(false)).toEqual({
      teleprompterOpen: false,
      studioNavOpen: true,
    });
  });
});

function chapter(overrides: Partial<ChapterFile>): ChapterFile {
  return {
    id: "chapter",
    index: 1,
    title: "Chapter",
    text_path: "manuscript/chapters/01.json",
    author_status: "draft",
    ...overrides,
  };
}
