import { estimateDurationMinutes } from "../../../../src/core/manuscript/split";
import type { BookChapter, BookProject } from "./store";
import { bookProgress } from "./store";

/** Dashboard figures: words, estimated finished hours, recorded count. */
export function bookStats(chapters: BookChapter[]): {
  words: number;
  pfh: string;
  recorded: number;
} {
  let words = 0;
  let minutes = 0;
  let recorded = 0;
  for (const chapter of chapters) {
    const count = Math.max(0, chapter.wordCount || 0);
    words += count;
    minutes += estimateDurationMinutes(count);
    if (chapter.hasOriginalAudio) {
      recorded += 1;
    }
  }
  const hours = minutes / 60;
  const pfh = hours >= 0.1 ? `${hours.toFixed(1)} hr` : `${Math.max(0, Math.round(minutes))} min`;
  return { words, pfh, recorded };
}

export function completionPct(project: BookProject): number {
  return Math.round(bookProgress(project) * 100);
}

export function chapterCompletionPct(chapter: BookChapter): number {
  const record = Math.min(1, Math.max(0, chapter.recordedPct));
  const proof = chapter.proofed ? 1 : 0;
  const master = chapter.mastered ? 1 : 0;
  return Math.round(((record + proof + master) / 3) * 100);
}
