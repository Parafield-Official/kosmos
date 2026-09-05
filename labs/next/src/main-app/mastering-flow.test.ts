import { describe, expect, it } from "vitest";
import { masterPcm } from "../../../../src/core/acx/master";
import {
  audioFilesInOrder,
  audioTitleFromName,
  collectAudioFiles,
  dummyMasteringFiles,
  isAudioFile,
  sortAudioFiles,
  voiceLikeWavFile,
} from "./mastering-flow";
import { arrayMove } from "./reorder";
import { bookProgress, isMasteringProject, reorderChapters, type BookChapter, type BookProject } from "./store";

function file(name: string, type = "audio/wav"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function chapter(partial: Partial<BookChapter> = {}): BookChapter {
  return {
    id: "ch_1",
    title: "One",
    wordCount: 0,
    recordedPct: 1,
    hasOriginalAudio: true,
    hasWorkingAudio: true,
    hasMasteredAudio: false,
    resumeWordIndex: 0,
    proofed: true,
    mastered: false,
    ...partial,
  };
}

function project(partial: Partial<BookProject> = {}): BookProject {
  return {
    id: "bk_1",
    title: "Northwind",
    author: "",
    chapters: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("audio-only mastering helpers", () => {
  it("turns a take filename into a chapter title", () => {
    expect(audioTitleFromName("Chapter_02-The Crossing.wav")).toBe("Chapter 02-The Crossing");
    expect(audioTitleFromName("")).toBe("Chapter");
  });

  it("sorts chapter files in natural order", () => {
    const files = sortAudioFiles([file("Chapter 10.wav"), file("Chapter 2.wav"), file("Chapter 1.wav")]);
    expect(files.map((item) => item.name)).toEqual(["Chapter 1.wav", "Chapter 2.wav", "Chapter 10.wav"]);
  });

  it("keeps audio files and drops documents", () => {
    expect(isAudioFile(file("ch1.wav"))).toBe(true);
    expect(isAudioFile(file("notes.txt", "text/plain"))).toBe(false);
    expect(collectAudioFiles([file("notes.txt", "text/plain"), file("b.mp3", "audio/mpeg")]).map((item) => item.name)).toEqual([
      "b.mp3",
    ]);
  });

  it("keeps a custom chapter order instead of sorting by name", () => {
    const files = audioFilesInOrder([file("02 Harbor.wav"), file("01 Drift.wav")]);
    expect(files.map((item) => item.name)).toEqual(["02 Harbor.wav", "01 Drift.wav"]);
  });

  it("builds five named dummy chapter takes for the create dialog", () => {
    const files = dummyMasteringFiles();
    expect(files.map((item) => item.name)).toEqual([
      "01 The Drift.wav",
      "02 Glass Harbor.wav",
      "03 Night Radio.wav",
      "04 The Last Orbit.wav",
      "05 Return.wav",
    ]);
    expect(files[0]?.type).toBe("audio/wav");
    expect(files[0]?.size).toBeGreaterThan(44);
  });

  it("moves a take in a list the way drag-to-reorder does", () => {
    expect(arrayMove(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
});

describe("dummy mastering audio", () => {
  it("gives the ACX master a speech-like region so silent takes are not used in dev", async () => {
    const file = voiceLikeWavFile("speech.wav", 6, 44100, 1);
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const sampleRate = view.getUint32(24, true);
    const samples = new Float32Array((buffer.byteLength - 44) / 2);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = view.getInt16(44 + i * 2, true) / 32767;
    }
    const result = masterPcm({ samples, sampleRate, channels: 1 });
    expect(result.status).toBe("ok");
    expect(result.abort_code).toBeUndefined();
    expect(result.samples.length).toBeGreaterThan(0);
  });
});

describe("chapter order", () => {
  it("rewrites chapter order from a list of ids", () => {
    const book = project({
      chapters: [
        chapter({ id: "ch_1", title: "One" }),
        chapter({ id: "ch_2", title: "Two" }),
        chapter({ id: "ch_3", title: "Three" }),
      ],
    });
    expect(reorderChapters(book, ["ch_3", "ch_1", "ch_2"]).chapters.map((item) => item.id)).toEqual([
      "ch_3",
      "ch_1",
      "ch_2",
    ]);
  });
});

describe("mastering project progress", () => {
  it("treats uploaded audio as half done until the take is mastered", () => {
    const book = project({
      kind: "mastering",
      chapters: [chapter({ mastered: false }), chapter({ id: "ch_2", mastered: true, hasMasteredAudio: true })],
    });
    expect(isMasteringProject(book)).toBe(true);
    expect(bookProgress(book)).toBe(0.75);
  });

  it("does not count proofing on a regular book when measuring thirds", () => {
    expect(bookProgress(project({ chapters: [chapter({ proofed: false, recordedPct: 1, mastered: false })] }))).toBeCloseTo(
      1 / 3,
    );
  });
});
