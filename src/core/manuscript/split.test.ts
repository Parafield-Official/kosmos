import { describe, expect, it } from "vitest";
import {
  estimateDurationMinutes,
  mergeChapters,
  renameChapter,
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
});
