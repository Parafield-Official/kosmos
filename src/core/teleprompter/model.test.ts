import { describe, expect, it } from "vitest";
import {
  bookDashboardStats,
  buildPromptLines,
  clampFontSize,
  createLiveFlagsState,
  dismissLiveFlag,
  filterPromptChapters,
  promptChapterStatus,
  promptTextTokens,
  promptWordCount,
  readingProgress,
  recordLiveFlag,
  relevantPromptGlossary,
  remainingReadTimeLabel,
  teleprompterLayout,
  liveHighlightWordIndex,
  liveCursorForVisibleLine,
  promptBandCovers,
  promptHighlightRange,
  promptRowAt,
  promptWordRows,
  type PromptSegment,
} from "./model";
import type { ChapterFile, GlossaryEntry } from "../project/types";

describe("teleprompter model", () => {
  it("splits manuscript text into exact renderable words without losing punctuation", () => {
    const tokens = promptTextTokens("Marie-Laure said, ‘don’t stop.’");

    expect(tokens.map((token) => token.text).join("")).toBe("Marie-Laure said, ‘don’t stop.’");
    expect(tokens.filter((token) => token.isWord).map((token) => token.text)).toEqual([
      "Marie",
      "Laure",
      "said",
      "don’t",
      "stop",
    ]);
    expect(promptWordCount("Marie-Laure said, ‘don’t stop.’")).toBe(5);
  });

  it("highlights the current follow word while voice follow is active", () => {
    expect(liveHighlightWordIndex(0, true)).toBe(0);
    expect(liveHighlightWordIndex(1, true)).toBe(1);
    expect(liveHighlightWordIndex(9, true)).toBe(9);
    expect(liveHighlightWordIndex(9, false)).toBe(-1);
  });

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
      { text: "# Chapter 1\n  # Leaflets", seat: "narration", style: [] },
    ]);

    expect(lines.map((line) => line.text)).not.toEqual(expect.arrayContaining([
      expect.stringContaining("#"),
    ]));
    expect(lines.map((line) => line.text)).toEqual([
      expect.stringContaining("Chapter 1"),
      expect.stringContaining("Leaflets"),
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

  it("starts gold on the first visible line, not a percent through the chapter", () => {
    const lines = [
      { top: 0, height: 80, wordStart: 0 },
      { top: 80, height: 80, wordStart: 12 },
      { top: 160, height: 80, wordStart: 40 },
      { top: 240, height: 80, wordStart: 90 },
    ];
    expect(liveCursorForVisibleLine(0, lines)).toBe(0);
    expect(liveCursorForVisibleLine(170, lines)).toBe(40);
    expect(liveCursorForVisibleLine(250, lines)).toBe(90);
  });

  it("groups a wrapped paragraph's words into visual rows by their top edge", () => {
    // Five words on the first row, three on the second, two on the third.
    const tops = [10, 10, 10, 10, 10, 52, 52, 52, 94, 94];
    expect(promptWordRows(20, tops)).toEqual([
      { from: 20, to: 24 },
      { from: 25, to: 27 },
      { from: 28, to: 29 },
    ]);
  });

  it("tolerates subpixel drift within a row", () => {
    expect(promptWordRows(0, [10, 10.4, 12.2, 48])).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 3 },
    ]);
  });

  it("extends the row in progress when a word cannot be measured", () => {
    // An unmeasured word must not open a row of its own at the wrong place.
    expect(promptWordRows(0, [10, null, 10, 48])).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 3 },
    ]);
  });

  it("finds the row holding the cursor", () => {
    const rows = promptWordRows(0, [0, 0, 40, 40, 80]);
    expect(promptRowAt(rows, 3)).toEqual({ from: 2, to: 3 });
    expect(promptRowAt(rows, 99)).toBeNull();
  });

  it("bands nothing in word mode, the row in line mode, the paragraph in paragraph mode", () => {
    const rows = promptWordRows(10, [0, 0, 0, 40, 40, 40]);
    const base = { wordIndex: 12, paragraphFirstWord: 10, paragraphWordCount: 6, rows };
    expect(promptHighlightRange({ ...base, mode: "word" })).toBeNull();
    expect(promptHighlightRange({ ...base, mode: "line" })).toEqual({ from: 10, to: 12 });
    expect(promptHighlightRange({ ...base, mode: "paragraph" })).toEqual({ from: 10, to: 15 });
  });

  it("bands nothing while follow is off or rows are unmeasured", () => {
    const off = { wordIndex: -1, paragraphFirstWord: 10, paragraphWordCount: 6, rows: [] };
    expect(promptHighlightRange({ ...off, mode: "paragraph" })).toBeNull();
    // Line mode holds off for one frame rather than flashing a paragraph band.
    expect(promptHighlightRange({
      mode: "line", wordIndex: 12, paragraphFirstWord: 10, paragraphWordCount: 6, rows: [],
    })).toBeNull();
  });

  it("bands the spacing between two banded words so the stripe is continuous", () => {
    const range = { from: 4, to: 6 };
    // Word tokens inside the range.
    expect(promptBandCovers(range, 4, true)).toBe(true);
    expect(promptBandCovers(range, 6, true)).toBe(true);
    expect(promptBandCovers(range, 7, true)).toBe(false);
    // Spacing after word 4 is inside; spacing before word 4 is not, so the
    // band does not bleed into the previous row.
    expect(promptBandCovers(range, 5, false)).toBe(true);
    expect(promptBandCovers(range, 4, false)).toBe(false);
    // Spacing after the last banded word stays clear.
    expect(promptBandCovers(range, 7, false)).toBe(false);
  });

  it("bands nothing when there is no range", () => {
    expect(promptBandCovers(null, 3, true)).toBe(false);
    expect(promptBandCovers(null, 3, false)).toBe(false);
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
