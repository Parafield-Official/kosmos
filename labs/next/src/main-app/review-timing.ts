import type { TranscriptWord } from "../../../../src/core/proof/align";
import { tokenizeManuscript } from "../../../../src/core/proof/normalize";
import type { BookChapter, RecordedWord } from "./store";

/** Booth word-clock → Whisper-shaped timings the redo range builder understands. */
export function transcriptFromRecordedWords(
  manuscript: string,
  words: RecordedWord[] | undefined,
): TranscriptWord[] {
  if (!words?.length) {
    return [];
  }
  const tokens = tokenizeManuscript(manuscript);
  return words.flatMap((word) => {
    const token = tokens[word.index];
    if (!token || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) {
      return [];
    }
    return [{ text: token.text, start: word.start, end: word.end }];
  });
}

export function originalChapterTranscript(manuscript: string, chapter: BookChapter): TranscriptWord[] {
  if (chapter.proofTranscript && chapter.proofTranscript.length > 0) {
    return chapter.proofTranscript;
  }
  return transcriptFromRecordedWords(manuscript, chapter.recordedWords);
}

export function shiftTimedWords<T extends { start: number; end: number }>(
  words: T[],
  applied: { start: number; end: number; durationDelta: number },
): T[] {
  const delta = Number.isFinite(applied.durationDelta) ? applied.durationDelta : 0;
  return words.flatMap((word) => {
    if (word.end <= applied.start) {
      return [word];
    }
    if (word.start < applied.end) {
      return [];
    }
    if (delta === 0) {
      return [word];
    }
    return [{ ...word, start: word.start + delta, end: word.end + delta }];
  });
}

/** Original-tape timings, walked through applied punches so a new redo lands on the working file. */
export function workingChapterTranscript(manuscript: string, chapter: BookChapter): TranscriptWord[] {
  let words = originalChapterTranscript(manuscript, chapter);
  for (const punch of chapter.punches ?? []) {
    if (punch.edit_status === "reverted") {
      continue;
    }
    words = shiftTimedWords(words, {
      start: punch.t_start,
      end: punch.t_end,
      durationDelta: punch.durationDelta ?? 0,
    });
  }
  return words;
}

/** Manuscript token whose tape span covers `time`, or the last word already reached. */
export function tokenIndexAtTime(
  aligned: Array<{ tokenIndex: number; start?: number; end?: number }>,
  time: number,
): number | null {
  if (!Number.isFinite(time) || aligned.length === 0) {
    return null;
  }
  let last = -1;
  let firstTimed = -1;
  for (const token of aligned) {
    if (token.start === undefined) {
      continue;
    }
    if (firstTimed < 0) {
      firstTimed = token.tokenIndex;
    }
    if (token.end !== undefined && time >= token.start && time < token.end) {
      return token.tokenIndex;
    }
    if (token.start <= time) {
      last = token.tokenIndex;
    }
  }
  if (last >= 0) {
    return last;
  }
  return firstTimed >= 0 ? firstTimed : null;
}

export function tokenSpanFromSelection(root: HTMLElement): { from: number; to: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  const hits = [...root.querySelectorAll<HTMLElement>("[data-token]")].filter((span) => {
    const spanRange = document.createRange();
    spanRange.selectNodeContents(span);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, spanRange) < 0
      && range.compareBoundaryPoints(Range.START_TO_END, spanRange) > 0
    );
  });
  if (hits.length === 0) {
    return null;
  }
  const indexes = hits.map((span) => Number(span.dataset.token)).filter((index) => Number.isFinite(index));
  if (indexes.length === 0) {
    return null;
  }
  return { from: Math.min(...indexes), to: Math.max(...indexes) };
}
