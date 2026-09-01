import { chapterStage, type BookChapter } from "./store";

export type BookTab = "dashboard" | "chapters" | "pronunciation" | "export";
export type ChapterStep = "recording" | "proofreading" | "mastering";

export function defaultChapterStep(chapter: BookChapter): ChapterStep {
  const stage = chapterStage(chapter);
  if (stage === "mastering" || stage === "done") {
    return "mastering";
  }
  if (stage === "proofing") {
    return "proofreading";
  }
  return "recording";
}

export function stepLocked(step: ChapterStep, chapter: BookChapter): boolean {
  if (step === "proofreading") {
    return chapter.recordedPct < 1;
  }
  if (step === "mastering") {
    return !chapter.proofed;
  }
  return false;
}

/**
 * A click on the Proofread step is also the user's request to run the proof
 * engine. Only an already-completed proof with a recorded engine can navigate
 * straight to the saved results; legacy/empty results must be checked again.
 */
export function proofStepAction(chapter: BookChapter): "run" | "navigate" {
  return chapter.proofed && chapter.proofTimingEngine ? "navigate" : "run";
}
