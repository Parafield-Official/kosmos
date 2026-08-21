import { describe, expect, it } from "vitest";
import { scanBookOccurrences, type ChapterSource } from "./book-scan";
import type { TranscriptWord } from "./align";

function spoken(text: string, from = 0.1): TranscriptWord[] {
  let cursor = from;
  return text.split(" ").map((word) => {
    const start = cursor;
    const end = start + 0.3;
    cursor = end + 0.1;
    return { text: word, start, end };
  });
}

const chapters: ChapterSource[] = [
  {
    chapterId: "ch01",
    chapterIndex: 1,
    chapterTitle: "Chapter One",
    manuscript: "They reached Leominster before dark.",
    transcript: spoken("They reached lemster before dark"),
  },
  {
    chapterId: "ch02",
    chapterIndex: 2,
    chapterTitle: "Chapter Two",
    manuscript: "Leominster was quiet. She left Leominster at dawn.",
    transcript: spoken("Leominster was quiet She left lemster at dawn"),
  },
  {
    chapterId: "ch03",
    chapterIndex: 3,
    chapterTitle: "Chapter Three",
    manuscript: "Leominster again, unrecorded.",
  },
];

describe("scanning a word across the book", () => {
  it("finds every occurrence and groups them by how they were read", () => {
    const report = scanBookOccurrences("Leominster", chapters);
    expect(report.totalOccurrences).toBe(4);
    expect(report.checkedOccurrences).toBe(3);
    expect(report.consistent).toBe(false);
    expect(report.readings.map((group) => [group.heard, group.count])).toEqual([
      ["lemster", 2],
      ["Leominster", 1],
      ["(not checked yet)", 1],
    ]);
  });

  it("names the chapters it could not check", () => {
    expect(scanBookOccurrences("Leominster", chapters).chaptersWithoutAudio).toEqual(["Chapter Three"]);
  });

  it("calls a word consistent when every checked reading agrees", () => {
    const report = scanBookOccurrences("quiet", chapters);
    expect(report.totalOccurrences).toBe(1);
    expect(report.consistent).toBe(true);
  });

  it("reports where each occurrence sits, with context and audio timing", () => {
    const report = scanBookOccurrences("Leominster", chapters);
    const first = report.readings.flatMap((group) => group.occurrences)
      .find((occurrence) => occurrence.chapterId === "ch01");
    expect(first?.context).toContain("reached Leominster before");
    expect(first?.offset).toBe(13);
    expect(first?.start).toBeCloseTo(0.9, 5);
  });

  it("matches a multi-word phrase", () => {
    const report = scanBookOccurrences("she left", chapters);
    expect(report.totalOccurrences).toBe(1);
    expect(report.readings[0].heard).toBe("She left");
  });

  it("does not match a word buried inside a hyphenated compound", () => {
    const source: ChapterSource[] = [{
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "A half-empty pier and a half loaf.",
      transcript: spoken("A half empty pier and a half loaf"),
    }];
    expect(scanBookOccurrences("half", source).totalOccurrences).toBe(1);
    expect(scanBookOccurrences("half-empty", source).totalOccurrences).toBe(1);
  });

  it("treats a number and its spoken form as the same reading", () => {
    const source: ChapterSource[] = [{
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "It closed in 1999.",
      transcript: spoken("It closed in nineteen ninety nine"),
    }];
    const report = scanBookOccurrences("1999", source);
    expect(report.totalOccurrences).toBe(1);
    expect(report.readings[0].heard).toBe("nineteen ninety nine");
    expect(report.consistent).toBe(true);
  });

  it("returns nothing for an empty search", () => {
    expect(scanBookOccurrences("   ", chapters).totalOccurrences).toBe(0);
  });
});
