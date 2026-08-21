import { describe, expect, it } from "vitest";
import { buildExportPlan, getExportReadiness, reportText } from "./export";
import { createEmptyProject, addChapter } from "../project/project";

describe("ACX export plan", () => {
  it("uses stable named chapter files and honest credit slots", () => {
    let project = createEmptyProject("Book", { id: "book-1", now: "2026-01-01T00:00:00.000Z" });
    project = addChapter(project, {
      id: "ch02",
      index: 2,
      title: "Second",
      text_path: "manuscript/chapters/02.json",
      audio_path: "audio/02_edited.wav",
      pickups_path: "alignment/02.json",
    });
    project = addChapter(project, {
      id: "ch01",
      index: 1,
      title: "First",
      text_path: "manuscript/chapters/01.json",
      audio_path: "audio/01_edited.wav",
      pickups_path: "alignment/01.json",
    });

    const plan = buildExportPlan(project);

    expect(plan.items.map((item) => item.fileName)).toEqual([
      "01_chapter_01.mp3",
      "02_chapter_02.mp3",
      "99_retail_sample.mp3",
    ]);
    expect(plan.readmeFiles.map((file) => file.fileName)).toEqual([
      "00_opening_credits_README.txt",
      "98_closing_credits_README.txt",
    ]);
    expect(plan.readmeFiles[0].contents).toContain("does not generate spoken credits");
  });

  it("writes before/after measurements into a readable report", () => {
    const report = reportText([{ fileName: "01_chapter_01.mp3", status: "pass", note: "clean", before: fakeReport(-24), after: fakeReport(-20) }]);
    expect(report).toContain("01_chapter_01.mp3 — PASS");
    expect(report).toContain("before: RMS -24.0 dBFS");
    expect(report).toContain("after:  RMS -20.0 dBFS");
  });

  it("blocks delivery readiness until every chapter has audio", () => {
    let project = createEmptyProject("Book", { id: "book-2", now: "2026-01-01T00:00:00.000Z" });
    project = addChapter(project, {
      id: "ch01",
      index: 1,
      title: "First",
      text_path: "manuscript/chapters/01.json",
    });
    project = addChapter(project, {
      id: "ch02",
      index: 2,
      title: "Second",
      text_path: "manuscript/chapters/02.json",
      audio_path: "audio/02.wav",
    });

    const readiness = getExportReadiness(project);

    expect(readiness.ready).toBe(false);
    expect(readiness.totalChapters).toBe(2);
    expect(readiness.attachedChapters).toBe(1);
    expect(readiness.missingAudio.map((chapter) => chapter.title)).toEqual(["First"]);
  });

  it("reports a complete book as ready for the transactional export", () => {
    let project = createEmptyProject("Book", { id: "book-3", now: "2026-01-01T00:00:00.000Z" });
    project = addChapter(project, {
      id: "ch01",
      index: 1,
      title: "First",
      text_path: "manuscript/chapters/01.json",
      audio_path: "audio/01.wav",
    });

    expect(getExportReadiness(project)).toMatchObject({
      totalChapters: 1,
      attachedChapters: 1,
      missingAudio: [],
      ready: true,
    });
  });
});

function fakeReport(rms: number) {
  return {
    preset_id: "acx",
    preset_label: "ACX / Audible",
    preset_source: "test fixture",
    rms_dbfs: rms,
    lufs_integrated: rms + 1,
    true_peak_dbfs: -4,
    sample_peak_dbfs: -4.2,
    noise_floor_dbfs: -65,
    noise_floor_start_seconds: 0.2,
    noise_floor_duration_seconds: 0.5,
    sample_rate: 44100,
    channels: 1,
    duration_seconds: 10,
    format: "wav" as const,
    head_room_tone_s: 1.5,
    tail_room_tone_s: 1.5,
    head_room_tone_is_digital_silence: false,
    tail_room_tone_is_digital_silence: false,
    checks: {
      rms: "pass" as const,
      loudness: "unspecified" as const,
      true_peak: "pass" as const,
      noise_floor: "pass" as const,
      sample_rate: "pass" as const,
      channels: "pass" as const,
      duration: "pass" as const,
      format: "pass" as const,
      head_room_tone: "pass" as const,
      tail_room_tone: "pass" as const,
    },
    traffic_light: "green" as const,
  };
}
