import { describe, expect, it } from "vitest";
import { reflectPickupDecision, summarizeBookPickups, type BookPickupChapter } from "./book-pickups";
import type { Pickup } from "../project/types";

function pickup(overrides: Partial<Pickup> & { id: string; chapter_id: string }): Pickup {
  return {
    t_start: 1,
    t_end: 1.5,
    expected: "word",
    heard: "ward",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 0.9,
    ...overrides,
  };
}

function chapter(overrides: Partial<BookPickupChapter> & { chapterId: string; chapterIndex: number }): BookPickupChapter {
  return {
    chapterTitle: `Chapter ${overrides.chapterIndex}`,
    hasAudio: true,
    checked: true,
    pickups: [],
    ...overrides,
  };
}

describe("summarizeBookPickups", () => {
  it("collects open flags from every chapter in reading order", () => {
    const summary = summarizeBookPickups([
      chapter({
        chapterId: "ch02",
        chapterIndex: 2,
        pickups: [pickup({ id: "b", chapter_id: "ch02", t_start: 4 })],
      }),
      chapter({
        chapterId: "ch01",
        chapterIndex: 1,
        pickups: [
          pickup({ id: "a2", chapter_id: "ch01", t_start: 9 }),
          pickup({ id: "a1", chapter_id: "ch01", t_start: 2 }),
        ],
      }),
    ]);
    expect(summary.open.map((row) => row.pickup.id)).toEqual(["a1", "a2", "b"]);
    expect(summary.openCount).toBe(3);
  });

  it("counts resolved work separately from what is left", () => {
    const summary = summarizeBookPickups([
      chapter({
        chapterId: "ch01",
        chapterIndex: 1,
        pickups: [
          pickup({ id: "a", chapter_id: "ch01", status: "done" }),
          pickup({ id: "b", chapter_id: "ch01", status: "ignored" }),
          pickup({ id: "c", chapter_id: "ch01" }),
        ],
      }),
    ]);
    expect(summary.openCount).toBe(1);
    expect(summary.resolvedCount).toBe(2);
    expect(summary.chapters[0]).toMatchObject({ open: 1, resolved: 2, total: 3 });
  });

  it("counts open flags by kind and ignores resolved ones", () => {
    const summary = summarizeBookPickups([
      chapter({
        chapterId: "ch01",
        chapterIndex: 1,
        pickups: [
          pickup({ id: "a", chapter_id: "ch01", kind: "skip" }),
          pickup({ id: "b", chapter_id: "ch01", kind: "skip" }),
          pickup({ id: "c", chapter_id: "ch01", kind: "pause" }),
          pickup({ id: "d", chapter_id: "ch01", kind: "insert", status: "done" }),
        ],
      }),
    ]);
    expect(summary.byKind).toEqual({ skip: 2, insert: 0, sub: 0, pause: 1 });
  });

  it("gathers a name flagged across chapters into one repeated word", () => {
    const summary = summarizeBookPickups([
      chapter({
        chapterId: "ch01",
        chapterIndex: 1,
        pickups: [
          pickup({ id: "a", chapter_id: "ch01", expected: "Leominster", heard: "lemster" }),
          pickup({ id: "b", chapter_id: "ch01", expected: "leominster.", heard: "lemster" }),
        ],
      }),
      chapter({
        chapterId: "ch02",
        chapterIndex: 2,
        pickups: [
          pickup({ id: "c", chapter_id: "ch02", expected: "Leominster", heard: "lemon stir" }),
          pickup({ id: "d", chapter_id: "ch02", expected: "dawn", heard: "down" }),
        ],
      }),
    ]);
    expect(summary.repeated).toHaveLength(1);
    expect(summary.repeated[0]).toMatchObject({ count: 3, chapters: 2 });
    expect(summary.repeated[0].word.toLowerCase()).toContain("leominster");
    expect(summary.repeated[0].rows.map((row) => row.pickup.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves a word flagged only once out of the repeated list", () => {
    const summary = summarizeBookPickups([
      chapter({
        chapterId: "ch01",
        chapterIndex: 1,
        pickups: [pickup({ id: "a", chapter_id: "ch01", expected: "dawn", heard: "down" })],
      }),
    ]);
    expect(summary.repeated).toEqual([]);
  });

  it("groups inserted words by what was said, since nothing was written", () => {
    const summary = summarizeBookPickups([
      chapter({
        chapterId: "ch01",
        chapterIndex: 1,
        pickups: [
          pickup({ id: "a", chapter_id: "ch01", kind: "insert", expected: "", heard: "um" }),
          pickup({ id: "b", chapter_id: "ch01", kind: "insert", expected: "", heard: "Um," }),
        ],
      }),
    ]);
    expect(summary.repeated).toHaveLength(1);
    expect(summary.repeated[0].count).toBe(2);
  });

  it("names chapters that have audio but were never checked", () => {
    const summary = summarizeBookPickups([
      chapter({ chapterId: "ch01", chapterIndex: 1, checked: true }),
      chapter({ chapterId: "ch02", chapterIndex: 2, checked: false }),
      chapter({ chapterId: "ch03", chapterIndex: 3, hasAudio: false, checked: false }),
    ]);
    expect(summary.uncheckedChapters.map((entry) => entry.chapterId)).toEqual(["ch02"]);
  });

  it("reports an empty book without inventing rows", () => {
    const summary = summarizeBookPickups([]);
    expect(summary).toMatchObject({ openCount: 0, resolvedCount: 0, open: [], repeated: [] });
    expect(summary.byKind).toEqual({ skip: 0, insert: 0, sub: 0, pause: 0 });
  });
});

describe("reflectPickupDecision", () => {
  const where = { chapterId: "ch01", chapterIndex: 1, chapterTitle: "Chapter 1" };

  function loaded() {
    return summarizeBookPickups([
      chapter({
        chapterId: "ch01",
        chapterIndex: 1,
        pickups: [
          pickup({ id: "a", chapter_id: "ch01", t_start: 2, expected: "Leominster" }),
          pickup({ id: "b", chapter_id: "ch01", t_start: 6, expected: "Leominster" }),
          pickup({ id: "c", chapter_id: "ch01", t_start: 9, status: "done" }),
        ],
      }),
      chapter({ chapterId: "ch02", chapterIndex: 2, pickups: [pickup({ id: "d", chapter_id: "ch02", t_start: 3 })] }),
    ]);
  }

  it("drops a flag settled in the chapter list and moves it to the handled count", () => {
    const summary = loaded();
    const next = reflectPickupDecision(
      summary,
      pickup({ id: "a", chapter_id: "ch01", t_start: 2, expected: "Leominster", status: "ignored" }),
      where,
    );
    expect(next.open.map((row) => row.pickup.id)).toEqual(["b", "d"]);
    expect(next.openCount).toBe(2);
    expect(next.resolvedCount).toBe(summary.resolvedCount + 1);
    expect(next.chapters[0]).toMatchObject({ open: 1, resolved: 2 });
    expect(next.chapters[1]).toMatchObject({ open: 1, resolved: 0 });
    // One of the pair is gone, so the word is no longer a repeat.
    expect(next.repeated).toEqual([]);
  });

  it("puts a reopened flag back in reading order", () => {
    const settled = reflectPickupDecision(
      loaded(),
      pickup({ id: "a", chapter_id: "ch01", t_start: 2, status: "done" }),
      where,
    );
    const reopened = reflectPickupDecision(
      settled,
      pickup({ id: "a", chapter_id: "ch01", t_start: 2, status: "open" }),
      where,
    );
    expect(reopened.open.map((row) => row.pickup.id)).toEqual(["a", "b", "d"]);
    expect(reopened.openCount).toBe(3);
    expect(reopened.resolvedCount).toBe(loaded().resolvedCount);
    expect(reopened.chapters[0]).toMatchObject({ open: 2, resolved: 1 });
  });

  it("keeps the counts alone when only a note changed", () => {
    const summary = loaded();
    const next = reflectPickupDecision(
      summary,
      pickup({ id: "a", chapter_id: "ch01", t_start: 2, expected: "Leominster", note: "Author says LEM-ster." }),
      where,
    );
    expect(next.openCount).toBe(summary.openCount);
    expect(next.resolvedCount).toBe(summary.resolvedCount);
    expect(next.open.find((row) => row.pickup.id === "a")?.pickup.note).toBe("Author says LEM-ster.");
    expect(next.chapters).toEqual(summary.chapters);
  });

  it("leaves a book it does not know about untouched", () => {
    const summary = loaded();
    const next = reflectPickupDecision(
      summary,
      pickup({ id: "zz", chapter_id: "ch09", t_start: 1, status: "done" }),
      { chapterId: "ch09", chapterIndex: 9, chapterTitle: "Chapter 9" },
    );
    expect(next.open.map((row) => row.pickup.id)).toEqual(["a", "b", "d"]);
    expect(next.chapters).toEqual(summary.chapters);
  });
});
