import { alignTranscript, preservePickupWorkflow } from "../../../../src/core/proof/align";
import { paragraphsFromHtml } from "./booth";
import { proofAlignOptions } from "./engine-prefs";
import { transcriptFromRecordedWords } from "./review-timing";
import { dropSuppressedPickups } from "./suppress";
import {
  applyChapterPickups,
  applyOriginalTape,
  applyWorkingTape,
  copyOriginalToWorking,
  patchChapter,
  readChapterContent,
  writeChapterAudio,
  type BookProject,
} from "./store";

export async function importChapterOriginal(
  project: BookProject,
  chapterId: string,
  file: File,
): Promise<BookProject> {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  const saved = await writeChapterAudio(project, chapterId, file, { slot: "original", name: file.name });
  if (!saved) {
    throw new Error("Could not save that audio file.");
  }
  return applyOriginalTape(project, chapterId, {
    file: saved,
    recordedPct: 1,
    resumeWordIndex: chapter?.wordCount ?? 0,
    freshTape: true,
  });
}

export async function runChapterProof(
  project: BookProject,
  chapterId: string,
): Promise<{ project: BookProject; note: string }> {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter?.originalFile) {
    throw new Error("Record or import a take first.");
  }
  const html = await readChapterContent(project, chapterId);
  const manuscript = paragraphsFromHtml(html).join("\n");
  let pickups = chapter.pickups ?? [];
  let proofTranscript = transcriptFromRecordedWords(manuscript, chapter.recordedWords);
  let note = "Booth tape is mapped to the manuscript. Live flags are kept; the working file is a copy of original.";
  if (!chapter.recordedWords || chapter.recordedWords.length === 0) {
    if (!window.kosmosNext?.transcribeChapter || !project.folder) {
      throw new Error("Proofreading imported audio needs the desktop app.");
    }
    const result = await window.kosmosNext.transcribeChapter({
      folder: project.folder,
      file: chapter.originalFile,
    });
    if (!result.ok) {
      throw new Error(result.reason || "Could not transcribe the original tape.");
    }
    proofTranscript = (result.words ?? []).map((word) => ({
      text: word.text,
      start: word.start,
      end: word.end,
    }));
    const aligned = alignTranscript({
      chapterId,
      manuscript,
      transcript: result.words ?? [],
      durationSeconds: (result.words ?? []).reduce((max, word) => Math.max(max, word.end), 1),
      ...proofAlignOptions(),
      suppressedWords: project.suppressedWords,
    });
    pickups = preservePickupWorkflow(chapter.pickups ?? [], aligned.pickups);
    const mismatches = pickups.filter((pickup) => pickup.kind !== "pause" && pickup.status === "open").length;
    note =
      mismatches === 0
        ? "No word changes found. Listen once for delivery."
        : `${mismatches} word ${mismatches === 1 ? "mismatch" : "mismatches"} filed.`;
  }
  pickups = dropSuppressedPickups(pickups, project.suppressedWords) ?? [];
  const working = await copyOriginalToWorking(project, chapterId);
  if (!working) {
    throw new Error("Could not create the working file from original.");
  }
  return {
    note,
    project: applyWorkingTape(
      applyChapterPickups(patchChapter(project, chapterId, { proofed: true, proofTranscript }), chapterId, pickups),
      chapterId,
      working,
    ),
  };
}
