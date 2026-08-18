import { describe, expect, it } from "vitest";
import { planSharePaths } from "./pack";
import { createEmptyProject, addChapter } from "../project/project";

describe("collaborator pack planning", () => {
  it("keeps all work in a full pack but removes derived and unreferenced audio in a light pack", () => {
    let project = createEmptyProject("Shared", { id: "shared" });
    project = addChapter(project, {
      id: "ch01",
      index: 1,
      title: "One",
      text_path: "manuscript/chapters/01.json",
      audio_path: "audio/01_edited.wav",
      pickups_path: "alignment/01.json",
    });
    project.glossary = [{
      id: "name",
      spelling: "Elena",
      clip_path: "audio/glossary/elena.wav",
      frequency: 3,
      source: "auto",
    }];
    const files = [
      "project.json",
      "acx_spec.json",
      "manuscript/chapters/01.json",
      "alignment/01.json",
      "audio/01_edited.wav",
      "audio/01_raw.wav",
      "audio/old_raw.wav",
      "audio/glossary/elena.wav",
      "export/acx/01_chapter.mp3",
      "local.me",
      ".git/config",
      ".DS_Store",
      "project.json.tmp-123",
      "export/.acx-staging-123/REPORT.txt",
      "audio/01_raw.wav.backup-123",
    ];

    const full = planSharePaths(project, files, { lightPack: false });
    expect(full).toContain("audio/old_raw.wav");
    expect(full).toContain("export/acx/01_chapter.mp3");

    const light = planSharePaths(project, files, { lightPack: true });
    expect(light).toEqual([
      "acx_spec.json",
      "alignment/01.json",
      "audio/01_edited.wav",
      "audio/glossary/elena.wav",
      "manuscript/chapters/01.json",
      "project.json",
    ]);
    expect(full).not.toContain("local.me");
    expect(full).not.toContain(".git/config");
    expect(full).not.toContain("project.json.tmp-123");
    expect(full).not.toContain("export/.acx-staging-123/REPORT.txt");
    expect(full).not.toContain("audio/01_raw.wav.backup-123");
  });

  it("rejects absolute and parent-traversal archive paths", () => {
    const project = createEmptyProject("Book", { id: "book" });
    expect(() => planSharePaths(project, ["../secret.txt"], { lightPack: false })).toThrow(
      /unsafe project path/i,
    );
    expect(() => planSharePaths(project, ["/tmp/secret.txt"], { lightPack: false })).toThrow(
      /unsafe project path/i,
    );
  });

  it("keeps a chapter's preserved raw take in a light pack after a punch edit", () => {
    let project = createEmptyProject("Edited book", { id: "edited-book" });
    project = addChapter(project, {
      id: "ch01",
      index: 1,
      title: "One",
      text_path: "manuscript/chapters/01.json",
      audio_path: "audio/01_edited.wav",
      raw_audio_path: "audio/01_raw.wav",
      edited_audio_path: "audio/01_edited.wav",
      pickups_path: "alignment/01.json",
    });

    const light = planSharePaths(project, [
      "project.json",
      "manuscript/chapters/01.json",
      "alignment/01.json",
      "audio/01_raw.wav",
      "audio/01_edited.wav",
    ], { lightPack: true });

    expect(light).toContain("audio/01_raw.wav");
  });
});
