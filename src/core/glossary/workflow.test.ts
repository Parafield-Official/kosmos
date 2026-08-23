import { describe, expect, it } from "vitest";
import type { GlossaryEntry } from "../project/types";
import type { TranscriptWord } from "../proof/align";
import {
  checkChapterPronunciations,
  nextPronunciationCue,
  nextPronunciationCueByRows,
  type PromptPronunciationCue,
} from "./workflow";

function spoken(text: string): TranscriptWord[] {
  let cursor = 0.1;
  return text.split(" ").map((word) => {
    const start = cursor;
    const end = start + 0.3;
    cursor = end + 0.1;
    return { text: word, start, end };
  });
}

function entry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    id: "leominster",
    spelling: "Leominster",
    respell: "LEM-ster",
    frequency: 1,
    source: "user",
    ...overrides,
  };
}

describe("pronunciation workflow", () => {
  it("offers the next pronunciation no more than two lines ahead", () => {
    const cues: PromptPronunciationCue[] = [
      { entryId: "passed", wordIndex: 4, lineIndex: 1 },
      { entryId: "next", wordIndex: 14, lineIndex: 3 },
      { entryId: "later", wordIndex: 30, lineIndex: 6 },
    ];

    expect(nextPronunciationCue(cues, 10, 1)?.entryId).toBe("next");
    expect(nextPronunciationCue(cues, 15, 3)).toBeNull();
  });

  it("keeps a pronunciation visible while its word is still ahead on the current line", () => {
    const cues: PromptPronunciationCue[] = [
      { entryId: "siobhan", wordIndex: 18, lineIndex: 2 },
    ];

    expect(nextPronunciationCue(cues, 15, 2)?.entryId).toBe("siobhan");
    expect(nextPronunciationCue(cues, 19, 2)).toBeNull();
  });

  it("uses actual wrapped rows when the teleprompter paragraph spans the screen", () => {
    const cues: PromptPronunciationCue[] = [
      { entryId: "far", wordIndex: 8, lineIndex: 0 },
    ];
    const tops = [10, 10, 50, 50, 90, 90, 130, 130, 170];

    expect(nextPronunciationCueByRows(cues, 0, tops)).toBeNull();
    expect(nextPronunciationCueByRows(cues, 4, tops)).toMatchObject({
      cue: cues[0],
      rowsAhead: 2,
    });
  });

  it("recognizes a phonetic ASR rendering that matches the agreed respelling", () => {
    const [check] = checkChapterPronunciations({
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "They reached Leominster before dark.",
      transcript: spoken("They reached lemster before dark"),
      entries: [entry()],
    });

    expect(check).toMatchObject({
      entryId: "leominster",
      status: "matches",
      heard: ["lemster"],
      occurrenceCount: 1,
      checkedCount: 1,
      start: 0.9,
      end: 1.2,
    });
  });

  it("does not claim success when ASR merely repeats the manuscript spelling", () => {
    const [check] = checkChapterPronunciations({
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "They reached Leominster before dark.",
      transcript: spoken("They reached Leominster before dark"),
      entries: [entry()],
    });

    expect(check.status).toBe("unverified");
  });

  it("calls two different observed readings inconsistent", () => {
    const [check] = checkChapterPronunciations({
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "Leominster was quiet. Leominster slept.",
      transcript: spoken("lemster was quiet leeominster slept"),
      entries: [entry()],
    });

    expect(check.status).toBe("inconsistent");
    expect(check.heard).toEqual(["lemster", "leeominster"]);
  });

  it("separates undecided words from words that have not been checked", () => {
    const undecided = checkChapterPronunciations({
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "Siobhan met Leominster.",
      transcript: spoken("shebahn met lemster"),
      entries: [entry({ id: "siobhan", spelling: "Siobhan", respell: undefined })],
    });
    const unheard = checkChapterPronunciations({
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "Siobhan met Leominster.",
      entries: [entry()],
    });

    expect(undecided[0]?.status).toBe("undecided");
    expect(unheard[0]?.status).toBe("unheard");
  });

  it("omits glossary entries that are not in this chapter", () => {
    expect(checkChapterPronunciations({
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "One",
      manuscript: "A quiet road.",
      transcript: spoken("A quiet road"),
      entries: [entry()],
    })).toEqual([]);
  });
});
