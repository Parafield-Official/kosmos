import { describe, expect, it } from "vitest";
import { createEmptyProject, addChapter, parseProject, serializeProject } from "./project";
import {
  addChapterNote,
  addPickupNote,
  canApproveChapters,
  setChapterAuthorStatus,
} from "./collaboration";
import type { Pickup } from "./types";

describe("folder collaboration roles", () => {
  it("round-trips an author note and approval for a narrator to read", () => {
    let project = createEmptyProject("Shared Book", {
      id: "shared-book",
      now: "2026-08-18T00:00:00.000Z",
    });
    project.people = [
      { name: "Alex Author", role: "author" },
      { name: "Nia Voice", role: "narrator", seat: "N1" },
    ];
    project = addChapter(project, {
      id: "ch01",
      index: 1,
      title: "Chapter 1",
      text_path: "manuscript/chapters/01.md",
    });
    project = addChapterNote(
      project,
      "ch01",
      "Alex Author",
      "That is Leominster, LEM-ster.",
      { id: "note-1", now: "2026-08-18T01:00:00.000Z" },
    );
    project = setChapterAuthorStatus(
      project,
      "ch01",
      "approved",
      "Alex Author",
      "2026-08-18T01:01:00.000Z",
    );

    const narratorCopy = parseProject(serializeProject(project));
    expect(canApproveChapters(narratorCopy, "Nia Voice")).toBe(false);
    expect(narratorCopy.chapters[0].author_status).toBe("approved");
    expect(narratorCopy.chapter_notes).toEqual([
      expect.objectContaining({ author: "Alex Author", body: "That is Leominster, LEM-ster." }),
    ]);
  });

  it("prevents a narrator from setting an author-only status", () => {
    let project = createEmptyProject("Book", { id: "book" });
    project.people = [
      { name: "Alex", role: "author" },
      { name: "Nia", role: "narrator", seat: "N1" },
    ];
    project = addChapter(project, {
      id: "ch01",
      index: 1,
      title: "One",
      text_path: "manuscript/chapters/01.md",
    });

    expect(() => setChapterAuthorStatus(project, "ch01", "approved", "Nia")).toThrow(
      /author role/i,
    );
    expect(() => addChapterNote(project, "ch01", "Nia", "Please approve this.")).toThrow(
      /author role/i,
    );
  });

  it("adds a plain-text author note to an existing pickup", () => {
    const pickup: Pickup = {
      id: "pickup-1",
      chapter_id: "ch01",
      t_start: 1,
      t_end: 2,
      expected: "Leominster",
      heard: "Lemster",
      kind: "sub",
      seat: "narration",
      status: "open",
      confidence: 0.9,
    };

    expect(addPickupNote(pickup, "Use the glossary clip.").note).toBe("Use the glossary clip.");
  });
});
