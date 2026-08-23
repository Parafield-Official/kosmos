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
    expect(decoded.settings?.pause_threshold_seconds).toBe(4);
  });

  it("round-trips a booth tape without treating it as the chapter take", () => {
    const original = createEmptyProject("A Small Book", {
      now: "2026-08-18T00:00:00.000Z",
      id: "project-1",
    });
    const withTape = addChapter(original, {
      id: "ch01",
      index: 1,
      title: "Chapter 1",
      text_path: "manuscript/chapters/01.json",
      live_audio_path: "audio/live/ch01_session.wav",
      pickups_path: "alignment/01.json",
    });

    expect(parseProject(serializeProject(withTape)).chapters[0]).toMatchObject({
      live_audio_path: "audio/live/ch01_session.wav",
    });
    expect(parseProject(serializeProject(withTape)).chapters[0].audio_path).toBeUndefined();
  });

  it("rejects malformed chapter records before they can crash a workflow", () => {
    const project = createEmptyProject("Book", { id: "book" });
    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [{
        id: "ch01",
        index: 1,
        title: "One",
        text_path: "../outside.json",
        author_status: "draft",
      }],
    }))).toThrow(/chapter|path/i);
  });

  it("rejects unsafe shared audio references", () => {
    const project = createEmptyProject("Book", { id: "book" });
    expect(() => parseProject(JSON.stringify({
      ...project,
      glossary: [{
        id: "glossary-1",
        spelling: "Name",
        frequency: 1,
        source: "user",
        clip_path: "../../voice.wav",
      }],
    }))).toThrow(/unsafe.*clip/i);
  });

  it("accepts only supported pickup verification states", () => {
    const project = addChapter(createEmptyProject("Book", { id: "book" }), {
      id: "ch01",
      index: 1,
      title: "One",
      text_path: "manuscript/chapters/01.json",
    });
    const punch = {
      id: "punch-1",
      chapter_id: "ch01",
      path: "audio/pickups/punch-1.wav",
      created_at: "2026-08-18T00:00:00.000Z",
    };

    expect(parseProject(JSON.stringify({
      ...project,
      punch_recordings: [{ ...punch, verification_status: "needs_verification" }],
    })).punch_recordings?.[0].verification_status).toBe("needs_verification");
    expect(() => parseProject(JSON.stringify({
      ...project,
      punch_recordings: [{ ...punch, verification_status: "maybe" }],
    }))).toThrow(/verification/i);
  });

  it("rejects duplicate glossary and dangling collaboration references", () => {
    const project = createEmptyProject("Book", { id: "book" });
    expect(() => parseProject(JSON.stringify({
      ...project,
      glossary: [
        { id: "same", spelling: "Name", frequency: 1, source: "user" },
        { id: "same", spelling: "Other", frequency: 1, source: "user" },
      ],
    }))).toThrow(/duplicate glossary/i);

    expect(() => parseProject(JSON.stringify({
      ...project,
      chapter_notes: [{ id: "note", chapter_id: "missing", author: "A", body: "B", created_at: "now" }],
    }))).toThrow(/unknown chapter/i);
  });

  it("rejects invalid persisted settings instead of silently changing behavior", () => {
    const project = createEmptyProject("Book", { id: "book" });
    expect(() => parseProject(JSON.stringify({
      ...project,
      settings: { ...project.settings, teleprompter_font_size: 0 },
    }))).toThrow(/teleprompter/i);
  });

  it("rejects duplicate chapter asset paths and unsafe chapter ids", () => {
    const project = createEmptyProject("Book", { id: "book" });
    const chapter = {
      id: "ch01",
      index: 1,
      title: "One",
      text_path: "manuscript/chapters/01.json",
      pickups_path: "alignment/01.json",
      author_status: "draft" as const,
    };
    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [chapter, { ...chapter, id: "ch02", index: 2 }],
    }))).toThrow(/path/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [{ ...chapter, id: "../outside" }],
    }))).toThrow(/chapter/i);
  });

  it("keeps writable project references inside their assigned asset folders", () => {
    const project = createEmptyProject("Book", { id: "book" });
    const chapter = {
      id: "ch01",
      index: 1,
      title: "One",
      text_path: "manuscript/chapters/01.json",
      pickups_path: "alignment/01.json",
      author_status: "draft" as const,
    };

    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [{ ...chapter, text_path: "project.json" }],
    }))).toThrow(/text path/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [{ ...chapter, pickups_path: "manuscript/chapters/01.json" }],
    }))).toThrow(/alignment path/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [{ ...chapter, audio_path: "acx_spec.json" }],
    }))).toThrow(/audio_path/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [{ ...chapter, live_audio_path: "acx_spec.json" }],
    }))).toThrow(/live_audio_path/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      room_test_path: "project.json",
    }))).toThrow(/room test path/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      glossary: [{ id: "name", spelling: "Name", frequency: 1, source: "user", clip_path: "project.json" }],
    }))).toThrow(/clip path/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      chapters: [chapter],
      punch_recordings: [{
        id: "punch-1",
        chapter_id: "ch01",
        path: "project.json",
        created_at: "2026-08-18T00:00:00.000Z",
      }],
    }))).toThrow(/audio path/i);
  });

  it("rejects unsupported ACX pins and ambiguous collaborator identities", () => {
    const project = createEmptyProject("Book", { id: "book" });
    expect(() => parseProject(JSON.stringify({
      ...project,
      acx_spec_version: "future-acx",
    }))).toThrow(/ACX spec version/i);
    expect(() => parseProject(JSON.stringify({
      ...project,
      people: [
        { name: "Alex", role: "author" },
        { name: " alex ", role: "narrator", seat: "N1" },
      ],
    }))).toThrow(/duplicate person/i);
  });
});
