import { describe, expect, it } from "vitest";
import { applyMergePlan, describeMergePlan, planProjectMerge, type MergeInput } from "./merge";
import type { ChapterFile, Pickup, ProjectFile } from "../project/types";

function chapter(overrides: Partial<ChapterFile> & { id: string; index: number }): ChapterFile {
  return {
    title: `Chapter ${overrides.index}`,
    text_path: `text/${overrides.id}.json`,
    author_status: "draft",
    ...overrides,
  };
}

function project(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    schema: 1,
    id: "book-1",
    name: "The Pier",
    mode: "solo",
    acx_spec_version: "1",
    author: "A",
    narrator_n1: "N",
    narrator_n2: "",
    people: [],
    seats: {
      narration: { label: "Narration", color: "#111" },
      N1: { label: "N1", color: "#222" },
      N2: { label: "N2", color: "#333" },
    },
    chapters: [chapter({ id: "ch01", index: 1 })],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function pickup(overrides: Partial<Pickup> & { id: string }): Pickup {
  return {
    chapter_id: "ch01",
    t_start: 1,
    t_end: 1.4,
    expected: "dawn",
    heard: "down",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 0.9,
    ...overrides,
  };
}

function input(overrides: Partial<MergeInput> = {}): MergeInput {
  return {
    local: project(),
    incoming: project(),
    incomingChapters: [],
    ...overrides,
  };
}

describe("planProjectMerge", () => {
  it("refuses a pack from a different book", () => {
    expect(() => planProjectMerge(input({ incoming: project({ id: "other" }) })))
      .toThrow(/different book/i);
  });

  it("adopts a recording for a chapter that has none here", () => {
    const plan = planProjectMerge(input({
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        audioPath: "audio/01.wav",
        hasAlignment: true,
      }],
    }));
    expect(plan.audioToAdopt).toEqual([{
      chapterId: "ch01",
      chapterTitle: "Chapter 1",
      relativePath: "audio/01.wav",
      withAlignment: true,
    }]);
    expect(plan.conflicts).toEqual([]);
  });

  it("keeps our recording and reports the disagreement when both sides have one", () => {
    const plan = planProjectMerge(input({
      local: project({ chapters: [chapter({ id: "ch01", index: 1, audio_path: "audio/mine.wav" })] }),
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        audioPath: "audio/theirs.wav",
      }],
    }));
    expect(plan.audioToAdopt).toEqual([]);
    expect(plan.conflicts).toEqual([{
      kind: "audio",
      chapterId: "ch01",
      chapterTitle: "Chapter 1",
      mine: "audio/mine.wav",
      theirs: "audio/theirs.wav",
    }]);
  });

  it("takes their decision on a flag nobody here has touched", () => {
    const plan = planProjectMerge(input({
      localPickups: { ch01: [pickup({ id: "p1" })] },
      localAlignedChapters: ["ch01"],
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        hasAlignment: true,
        pickups: [pickup({ id: "p1", status: "done", note: "re-recorded" })],
      }],
    }));
    expect(plan.decisions).toEqual([
      { chapterId: "ch01", pickupId: "p1", status: "done", note: "re-recorded" },
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it("reports a flag both sides decided differently instead of picking one", () => {
    const plan = planProjectMerge(input({
      localPickups: { ch01: [pickup({ id: "p1", status: "ignored" })] },
      localAlignedChapters: ["ch01"],
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        hasAlignment: true,
        pickups: [pickup({ id: "p1", status: "done" })],
      }],
    }));
    expect(plan.decisions).toEqual([]);
    expect(plan.conflicts).toEqual([{
      kind: "pickup",
      chapterId: "ch01",
      chapterTitle: "Chapter 1",
      pickupId: "p1",
      expected: "dawn",
      mine: "ignored",
      theirs: "done",
    }]);
  });

  it("keeps our decision without complaint when they left the flag open", () => {
    const plan = planProjectMerge(input({
      localPickups: { ch01: [pickup({ id: "p1", status: "done" })] },
      localAlignedChapters: ["ch01"],
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        hasAlignment: true,
        pickups: [pickup({ id: "p1", status: "open" })],
      }],
    }));
    expect(plan.decisions).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it("counts their flags that do not line up with ours", () => {
    const plan = planProjectMerge(input({
      localPickups: { ch01: [pickup({ id: "p1" })] },
      localAlignedChapters: ["ch01"],
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        hasAlignment: true,
        pickups: [pickup({ id: "from-their-run", status: "done" })],
      }],
    }));
    expect(plan.skipped.unknownPickups).toBe(1);
    expect(plan.decisions).toEqual([]);
  });

  it("does not plan flag decisions when their whole proof pass is being taken", () => {
    const plan = planProjectMerge(input({
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        audioPath: "audio/01.wav",
        hasAlignment: true,
        pickups: [pickup({ id: "p1", status: "done" })],
      }],
    }));
    expect(plan.decisions).toEqual([]);
    expect(plan.audioToAdopt[0].withAlignment).toBe(true);
    expect(plan.skipped.unknownPickups).toBe(0);
  });

  it("brings over notes we have not seen and skips notes for chapters we lack", () => {
    const plan = planProjectMerge(input({
      local: project({
        chapter_notes: [
          { id: "n1", chapter_id: "ch01", author: "A", body: "old", created_at: "2026-01-01T00:00:00.000Z" },
        ],
      }),
      incoming: project({
        chapter_notes: [
          { id: "n1", chapter_id: "ch01", author: "A", body: "old", created_at: "2026-01-01T00:00:00.000Z" },
          { id: "n2", chapter_id: "ch01", author: "A", body: "new", created_at: "2026-02-01T00:00:00.000Z" },
          { id: "n3", chapter_id: "ch09", author: "A", body: "orphan", created_at: "2026-02-01T00:00:00.000Z" },
        ],
      }),
    }));
    expect(plan.notesToAdd.map((note) => note.id)).toEqual(["n2"]);
    expect(plan.skipped.orphanNotes).toBe(1);
  });

  it("adds pronunciations we do not have and fills in a missing respell", () => {
    const plan = planProjectMerge(input({
      local: project({
        glossary: [
          { id: "g1", spelling: "Leominster", frequency: 3, source: "auto" },
        ],
      }),
      incoming: project({
        glossary: [
          { id: "g1", spelling: "leominster", respell: "LEM-ster", frequency: 3, source: "user" },
          { id: "g2", spelling: "Siobhan", respell: "shi-VAWN", frequency: 1, source: "user" },
        ],
      }),
    }));
    expect(plan.glossaryRespells).toEqual([
      { id: "g1", spelling: "Leominster", respell: "LEM-ster" },
    ]);
    expect(plan.glossaryToAdd.map((entry) => entry.spelling)).toEqual(["Siobhan"]);
  });

  it("keeps an incoming pronunciation from landing on one of our ids", () => {
    const plan = planProjectMerge(input({
      local: project({ glossary: [{ id: "g1", spelling: "Leominster", frequency: 1, source: "auto" }] }),
      incoming: project({ glossary: [{ id: "g1", spelling: "Siobhan", frequency: 1, source: "user" }] }),
    }));
    expect(plan.glossaryToAdd[0].id).not.toBe("g1");
  });

  it("leaves our respell alone when theirs differs", () => {
    const plan = planProjectMerge(input({
      local: project({
        glossary: [{ id: "g1", spelling: "Leominster", respell: "LEM-in-ster", frequency: 1, source: "user" }],
      }),
      incoming: project({
        glossary: [{ id: "g1", spelling: "Leominster", respell: "LEM-ster", frequency: 1, source: "user" }],
      }),
    }));
    expect(plan.glossaryRespells).toEqual([]);
    expect(plan.glossaryToAdd).toEqual([]);
  });

  it("takes a chapter status that was set after ours", () => {
    const plan = planProjectMerge(input({
      local: project({
        chapters: [chapter({ id: "ch01", index: 1, updated_at: "2026-01-01T00:00:00.000Z" })],
      }),
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        authorStatus: "approved",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
    }));
    expect(plan.statusChanges).toEqual([
      { chapterId: "ch01", chapterTitle: "Chapter 1", from: "draft", to: "approved" },
    ]);
  });

  it("reports a stale status rather than reverting ours", () => {
    const plan = planProjectMerge(input({
      local: project({
        chapters: [chapter({ id: "ch01", index: 1, author_status: "approved", updated_at: "2026-05-01T00:00:00.000Z" })],
      }),
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        authorStatus: "needs_pickup",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }],
    }));
    expect(plan.statusChanges).toEqual([]);
    expect(plan.conflicts).toEqual([{
      kind: "status",
      chapterId: "ch01",
      chapterTitle: "Chapter 1",
      mine: "approved",
      theirs: "needs_pickup",
    }]);
  });

  it("names chapters they have that this project does not", () => {
    const plan = planProjectMerge(input({
      incomingChapters: [{ chapterId: "ch99", title: "Their extra chapter", index: 9 }],
    }));
    expect(plan.skipped.unknownChapters).toEqual(["Their extra chapter"]);
    expect(plan.empty).toBe(true);
  });

  it("flags a script that no longer matches so timings are not trusted blindly", () => {
    const plan = planProjectMerge(input({
      incomingChapters: [{ chapterId: "ch01", title: "Chapter 1", index: 1, scriptDiffers: true }],
    }));
    expect(plan.conflicts).toEqual([{ kind: "script", chapterId: "ch01", chapterTitle: "Chapter 1" }]);
  });

  it("reports an identical pack as nothing to do", () => {
    const shared = project({
      glossary: [{ id: "g1", spelling: "Leominster", respell: "LEM-ster", frequency: 1, source: "user" }],
      chapter_notes: [{ id: "n1", chapter_id: "ch01", author: "A", body: "hi", created_at: "2026-01-01T00:00:00.000Z" }],
    });
    const plan = planProjectMerge(input({
      local: shared,
      incoming: shared,
      incomingChapters: [{ chapterId: "ch01", title: "Chapter 1", index: 1, authorStatus: "draft" }],
    }));
    expect(plan.empty).toBe(true);
    expect(plan.conflicts).toEqual([]);
    expect(describeMergePlan(plan)).toBe("Nothing in this pack is new here.");
  });
});

describe("applyMergePlan", () => {
  it("records an adopted recording and its proof pass", () => {
    const local = project();
    const plan = planProjectMerge(input({
      local,
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        audioPath: "audio/01.wav",
        hasAlignment: true,
      }],
    }));
    const merged = applyMergePlan(local, plan, {
      now: "2026-06-01T00:00:00.000Z",
      alignmentPathFor: () => "alignment/01.json",
    });
    expect(merged.chapters[0].audio_path).toBe("audio/01.wav");
    expect(merged.chapters[0].pickups_path).toBe("alignment/01.json");
    expect(merged.chapters[0].updated_at).toBe("2026-06-01T00:00:00.000Z");
    expect(merged.updated_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("does not record a proof pass that was not copied", () => {
    const local = project();
    const plan = planProjectMerge(input({
      local,
      incomingChapters: [{ chapterId: "ch01", title: "Chapter 1", index: 1, audioPath: "audio/01.wav", hasAlignment: true }],
    }));
    const merged = applyMergePlan(local, plan, { alignmentPathFor: () => undefined });
    expect(merged.chapters[0].audio_path).toBe("audio/01.wav");
    expect(merged.chapters[0].pickups_path).toBeUndefined();
  });

  it("appends notes in the order they were written", () => {
    const local = project({
      chapter_notes: [{ id: "n2", chapter_id: "ch01", author: "A", body: "second", created_at: "2026-02-01T00:00:00.000Z" }],
    });
    const plan = planProjectMerge(input({
      local,
      incoming: project({
        chapter_notes: [
          { id: "n1", chapter_id: "ch01", author: "A", body: "first", created_at: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    }));
    const merged = applyMergePlan(local, plan);
    expect(merged.chapter_notes?.map((note) => note.body)).toEqual(["first", "second"]);
  });

  it("fills in a respell without touching the rest of the entry", () => {
    const local = project({
      glossary: [{ id: "g1", spelling: "Leominster", frequency: 4, source: "auto" }],
    });
    const plan = planProjectMerge(input({
      local,
      incoming: project({
        glossary: [{ id: "gx", spelling: "Leominster", respell: "LEM-ster", frequency: 1, source: "user" }],
      }),
    }));
    const merged = applyMergePlan(local, plan);
    expect(merged.glossary?.[0]).toEqual({
      id: "g1",
      spelling: "Leominster",
      respell: "LEM-ster",
      frequency: 4,
      source: "auto",
    });
  });

  it("leaves chapters alone when the plan has nothing for them", () => {
    const local = project({ chapters: [chapter({ id: "ch01", index: 1 }), chapter({ id: "ch02", index: 2 })] });
    const plan = planProjectMerge(input({
      local,
      incomingChapters: [{ chapterId: "ch01", title: "Chapter 1", index: 1, audioPath: "audio/01.wav" }],
    }));
    const merged = applyMergePlan(local, plan, { now: "2026-06-01T00:00:00.000Z" });
    expect(merged.chapters[1]).toBe(local.chapters[1]);
  });
});

describe("describeMergePlan", () => {
  it("says what an import would bring in plain words", () => {
    const plan = planProjectMerge(input({
      local: project(),
      incoming: project({
        chapter_notes: [{ id: "n1", chapter_id: "ch01", author: "A", body: "hi", created_at: "2026-01-01T00:00:00.000Z" }],
      }),
      incomingChapters: [{
        chapterId: "ch01",
        title: "Chapter 1",
        index: 1,
        audioPath: "audio/01.wav",
        hasAlignment: true,
      }],
    }));
    expect(describeMergePlan(plan)).toBe("Brings 1 recording and 1 note.");
  });

  it("says how many disagreements need a person", () => {
    const plan = planProjectMerge(input({
      local: project({ chapters: [chapter({ id: "ch01", index: 1, audio_path: "audio/mine.wav" })] }),
      incomingChapters: [{ chapterId: "ch01", title: "Chapter 1", index: 1, audioPath: "audio/theirs.wav" }],
    }));
    expect(describeMergePlan(plan)).toContain("1 disagreement needs your decision.");
  });
});
