import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "../../../../src/core/proof/align";
import { expandPickupToScope } from "./punch-scope";
import type { ChapterPickup } from "./store";

const manuscript = "Hello world. Next line here.\n\nSecond paragraph now.";
const transcript: TranscriptWord[] = [
  { text: "Hello", start: 0, end: 0.3 },
  { text: "world", start: 0.4, end: 0.8 },
  { text: "Next", start: 1.0, end: 1.3 },
  { text: "line", start: 1.4, end: 1.7 },
  { text: "here", start: 1.8, end: 2.1 },
  { text: "Second", start: 2.4, end: 2.8 },
  { text: "paragraph", start: 2.9, end: 3.4 },
  { text: "now", start: 3.5, end: 3.8 },
];

const pickup: ChapterPickup = {
  id: "flag-world",
  chapter_id: "ch-1",
  t_start: 0.4,
  t_end: 0.8,
  expected: "world",
  heard: "word",
  kind: "sub",
  seat: "narration",
  status: "open",
  confidence: 1,
  manuscript_index: 1,
};

describe("expandPickupToScope", () => {
  it("widens a word flag to its sentence, not a single word", () => {
    const next = expandPickupToScope(pickup, manuscript, transcript, "sentence");
    expect(next.selection_kind).toBe("sentence");
    expect(next.line_text).toMatch(/Hello world/);
    expect(next.t_start).toBe(0);
    expect(next.t_end).toBe(0.8);
    expect(next.id).toBe(pickup.id);
    expect(next.kind).toBe("sub");
  });

  it("widens to the paragraph when asked", () => {
    const next = expandPickupToScope(pickup, manuscript, transcript, "paragraph");
    expect(next.selection_kind).toBe("paragraph");
    expect(next.line_text).toMatch(/Next line here/);
    expect(next.t_end).toBe(2.1);
  });
});
