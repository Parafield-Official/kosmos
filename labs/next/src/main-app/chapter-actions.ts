import { alignTranscript, preservePickupWorkflow } from "../../../../src/core/proof/align";
import { paragraphsFromHtml } from "./booth";
import { proofAlignOptions } from "./engine-prefs";
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
  if (!window.kosmosNext?.transcribeChapter || !project.folder) {
    throw new Error("Proofreading needs the desktop app.");
  }
  // Always re-transcribe the saved original tape for final proofing. The live
  // follower is intentionally optimized for cursor movement, not a complete
  // record of misreads, extras, omissions, spelling errors, or pauses.
  const result = await window.kosmosNext.transcribeChapter({
    folder: project.folder,
    file: chapter.originalFile,
  });
  if (!result.ok) {
    throw new Error(result.reason || "Could not transcribe the original tape.");
  }
  const proofTranscript = (result.words ?? []).map((word) => ({
    text: word.text,
    start: word.start,
    end: word.end,
    ...(Number.isFinite(word.confidence) ? { confidence: word.confidence } : {}),
  }));
  const durationSeconds = Math.max(
    1,
    proofTranscript.reduce((max, word) => Math.max(max, word.end), 0),
    (result.silences ?? []).reduce((max, silence) => Math.max(max, silence.end), 0),
  );
  const aligned = alignTranscript({
    chapterId,
    manuscript,
    transcript: proofTranscript,
    durationSeconds,
    ...proofAlignOptions(),
    suppressedWords: project.suppressedWords,
    silences: result.silences ?? [],
  });
  const pickups = dropSuppressedPickups(
    preservePickupWorkflow(chapter.pickups ?? [], aligned.pickups),
    project.suppressedWords,
  ) ?? [];
  const mismatches = pickups.filter((pickup) => pickup.kind !== "pause" && pickup.status === "open").length;
  const pauses = pickups.filter((pickup) => pickup.kind === "pause" && pickup.status === "open").length;
  const note = mismatches === 0 && pauses === 0
    ? "No word changes or long pauses found. Listen once for delivery."
    : `${mismatches} word ${mismatches === 1 ? "mismatch" : "mismatches"} and ${pauses} long ${pauses === 1 ? "pause" : "pauses"} filed.`;
  const working = await copyOriginalToWorking(project, chapterId);
  if (!working) {
    throw new Error("Could not create the working file from original.");
  }
  return {
    note,
    project: applyWorkingTape(
            applyChapterPickups(
              patchChapter(project, chapterId, {
                proofed: true,
                proofTranscript,
                proofTimingEngine: result.timingEngine === "whisperx" ? "whisperx" : "whisper.cpp",
              }),
              chapterId,
              pickups,
            ),
      chapterId,
      working,
    ),
  };
}
