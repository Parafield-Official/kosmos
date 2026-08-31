import { chapterStage, type BookChapter } from "./store";

export type BookTab = "dashboard" | "chapters" | "pronunciation";
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
