import { describe, expect, it } from "vitest";
import { summarizeBookPickups, type BookPickupChapter } from "./book-pickups";
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
