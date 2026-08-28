import type { RoomCheckReport } from "./store";
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

/** Room check has a passing measurement (not just opened). */
export function roomCheckReady(report: RoomCheckReport | undefined): boolean {
  return report?.status === "pass";
}

export function recordingGate(input: {
  unresolvedPronunciations: number;
  roomCheck?: RoomCheckReport;
}): { ok: boolean; reason: string | null } {
  if (!roomCheckReady(input.roomCheck)) {
    return { ok: false, reason: "Finish the room check first. It has to pass before you record." };
  }
  if (input.unresolvedPronunciations > 0) {
    return {
      ok: false,
      reason:
        input.unresolvedPronunciations === 1
          ? "Set a pronunciation for the remaining flagged word, then you can record."
          : `Set pronunciations for ${input.unresolvedPronunciations} remaining flagged words, then you can record.`,
    };
  }
  return { ok: true, reason: null };
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
