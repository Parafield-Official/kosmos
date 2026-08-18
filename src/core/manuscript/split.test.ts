import { describe, expect, it } from "vitest";
import {
  estimateDurationMinutes,
  mergeChapters,
  parsePastedChapter,
  renameChapter,
  sliceScriptSpans,
  splitChapterAt,
  splitManuscript,
} from "./split";

describe("manuscript chapter splitting", () => {
  it("detects book headings without treating numbered prose as chapters", () => {
    const manuscript = [
      "Copyright 2026",
      "",
      "Opening Credits",
      "Written by A. Author",
      "",
      "CHAPTER 1 — Arrival",
      "The train stopped.",
      "1. First, Elena checked the platform.",
      "2. Then she checked her bag.",
      "",
      "Chapter Two: The Road",
      "She walked north.",
      "",
      "EPILOGUE",
      "Home again.",
    ].join("\n");

    const chapters = splitManuscript(manuscript);

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Front matter",
      "Opening Credits",
      "CHAPTER 1 — Arrival",
      "Chapter Two: The Road",
      "EPILOGUE",
    ]);
    expect(chapters[2].text).toContain("1. First, Elena checked the platform.");
    expect(chapters[2].text).toContain("2. Then she checked her bag.");
    expect(chapters[3].text).toBe("She walked north.");
  });

  it("recognizes isolated numbered headings and falls back to one chapter", () => {
    const numbered = splitManuscript("1. Arrival\n\nText one.\n\n2. Return\n\nText two.");
    expect(numbered.map((chapter) => chapter.title)).toEqual(["1. Arrival", "2. Return"]);

    const plain = splitManuscript("A paragraph with no heading.", { defaultTitle: "Untitled" });
    expect(plain).toHaveLength(1);
    expect(plain[0]).toMatchObject({ title: "Untitled", text: "A paragraph with no heading." });
  });

  it("recognizes Markdown chapter headings and keeps the marker out of the body", () => {
    const chapters = splitManuscript(
      "# Chapter 1\n\nThe Bridgertons are the most prolific family in London.\n\n## Chapter 2\n\nThe next story begins.",
    );

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(chapters.map((chapter) => chapter.text)).toEqual([
      "The Bridgertons are the most prolific family in London.",
      "The next story begins.",
    ]);
    expect(chapters[0].text).not.toContain("# Chapter 1");
  });

  it("normalizes a single pasted chapter and rejects a whole-book paste", () => {
    expect(parsePastedChapter("# Chapter 1\n\nThe opening line.")).toEqual({
      title: "Chapter 1",
      text: "The opening line.",
    });
    expect(() => parsePastedChapter("# Chapter 1\n\nFirst.\n\n# Chapter 2\n\nSecond.")).toThrow(
      /one chapter at a time/i,
    );
  });

  it("estimates ACX duration and flags chapters over two hours", () => {
    expect(estimateDurationMinutes(9_300)).toBe(60);

    const long = splitManuscript(Array.from({ length: 18_601 }, () => "word").join(" "))[0];
    expect(long.estimated_duration_minutes).toBeGreaterThan(120);
    expect(long.over_120_minutes).toBe(true);
  });

  it("supports lossless manual split, merge, and rename operations", () => {
    const original = splitManuscript("Alpha paragraph.\n\nBeta paragraph.")[0];
    const splitOffset = original.text.indexOf("Beta");
    const [left, right] = splitChapterAt(original, splitOffset, "Second half");

    expect(left.text + right.text).toBe(original.text);
    expect(right.title).toBe("Second half");

    const merged = mergeChapters(left, right);
    expect(merged.text).toBe(original.text);
    expect(renameChapter(merged, "Renamed").title).toBe("Renamed");
  });

  it("slices styled spans without flattening DOCX emphasis", () => {
    const spans = [
      { text: "Chapter 1\n", seat: "narration" as const, style: [] },
      { text: "soft", seat: "narration" as const, style: ["italic" as const] },
      { text: " and loud", seat: "N1" as const, style: ["bold" as const] },
    ];
    expect(sliceScriptSpans(spans, 10, 23)).toEqual([
      { text: "soft", seat: "narration", style: ["italic"] },
      { text: " and loud", seat: "N1", style: ["bold"] },
    ]);
  });
});
