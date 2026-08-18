import { describe, expect, it } from "vitest";
import {
  addChapter,
  createEmptyProject,
  parseProject,
  serializeProject,
} from "./project";

describe("project folder model", () => {
  it("round-trips a project with seats and a chapter", () => {
    const original = createEmptyProject("A Small Book", {
      now: "2026-08-18T00:00:00.000Z",
      id: "project-1",
    });
    const withChapter = addChapter(original, {
      id: "ch01",
      index: 1,
      title: "Chapter 1",
      text_path: "manuscript/chapters/01.json",
      audio_path: "audio/01_raw.wav",
      pickups_path: "alignment/01.json",
    });

    const decoded = parseProject(serializeProject(withChapter));

    expect(decoded).toEqual(withChapter);
    expect(decoded.seats.N1.label).toBe("N1");
    expect(decoded.seats.N2.label).toBe("N2");
    expect(decoded.chapters[0].author_status).toBe("draft");
  });
});

