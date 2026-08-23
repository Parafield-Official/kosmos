import type { GlossaryEntry } from "../project/types";
import type { TranscriptWord } from "../proof/align";
import { scanBookOccurrences } from "../proof/book-scan";

export interface PromptPronunciationCue {
  entryId: string;
  /** Manuscript word where the glossary phrase begins. */
  wordIndex: number;
  /** Prompt line containing the glossary phrase. */
  lineIndex: number;
}

export type PronunciationCheckStatus =
  | "matches"
  | "inconsistent"
  | "review"
  | "unverified"
  | "undecided"
  | "unheard";

export interface PronunciationCheck {
  entryId: string;
  spelling: string;
  respell?: string;
  status: PronunciationCheckStatus;
  /** Distinct renderings reported by ASR for checked occurrences. */
  heard: string[];
  occurrenceCount: number;
  checkedCount: number;
  /** First aligned occurrence, for one-click listening in the booth. */
  start?: number;
  end?: number;
}

export interface ChapterPronunciationCheckInput {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  manuscript: string;
  transcript?: TranscriptWord[];
  entries: GlossaryEntry[];
}

/**
 * Return the one silent prompt worth showing to a narrator now.
 *
 * Cues behind the cursor are over. Cues more than two manuscript lines away are
 * too early to help and become visual noise. A cue on the current line remains
 * useful only until its first word has been reached.
 */
export function nextPronunciationCue(
  cues: PromptPronunciationCue[],
  cursorWordIndex: number,
  currentLineIndex: number,
  maxLinesAhead = 2,
): PromptPronunciationCue | null {
  const cursor = Math.max(0, cursorWordIndex);
  const line = Math.max(0, currentLineIndex);
  return [...cues]
    .sort((left, right) => left.wordIndex - right.wordIndex)
    .find((cue) => cue.wordIndex >= cursor
      && cue.lineIndex >= line
      && cue.lineIndex - line <= Math.max(0, maxLinesAhead)) ?? null;
}

/**
 * Visual-row version of `nextPronunciationCue`. A manuscript paragraph may
 * wrap over half a dozen screen lines, so paragraph indexes alone can announce
 * a name much too early. Browser measurements are passed in as plain numbers to
 * keep this rule deterministic and testable.
 */
export function nextPronunciationCueByRows(
  cues: PromptPronunciationCue[],
  cursorWordIndex: number,
  wordTops: Array<number | null>,
  maxRowsAhead = 2,
): { cue: PromptPronunciationCue; rowsAhead: number } | null {
  const cursor = Math.max(0, cursorWordIndex);
  if (wordTops[cursor] === null || wordTops[cursor] === undefined) {
    return null;
  }
  const cue = [...cues]
    .sort((left, right) => left.wordIndex - right.wordIndex)
    .find((candidate) => candidate.wordIndex >= cursor);
  if (!cue || cue.wordIndex >= wordTops.length) {
    return null;
  }
  const rows: number[] = [];
  for (let index = cursor; index <= cue.wordIndex; index += 1) {
    const top = wordTops[index];
    if (top === null || top === undefined) {
      continue;
    }
    if (rows.length === 0 || Math.abs(top - rows[rows.length - 1]) > 2) {
      rows.push(top);
    }
  }
  const rowsAhead = Math.max(0, rows.length - 1);
  return rowsAhead <= Math.max(0, maxRowsAhead) ? { cue, rowsAhead } : null;
}

/**
 * Compare the recogniser's renderings of each chapter glossary entry with the
 * book's agreed respelling.
 *
 * This deliberately has an "unverified" state. Speech recognisers often return
 * the manuscript spelling even when they heard a different pronunciation; that
 * is not evidence that the narrator said the guide correctly. Only a phonetic
 * rendering that agrees with the respelling is called a match. Everything else
 * asks for a listen instead of inventing certainty.
 */
export function checkChapterPronunciations(
  input: ChapterPronunciationCheckInput,
): PronunciationCheck[] {
  return input.entries.flatMap((entry) => {
    const report = scanBookOccurrences(entry.spelling, [{
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      chapterTitle: input.chapterTitle,
      manuscript: input.manuscript,
      transcript: input.transcript,
    }]);
    if (report.totalOccurrences === 0) {
      return [];
    }

    const spokenGroups = report.readings.filter(
      (group) => group.occurrences[0]?.readingKey !== "#no-audio",
    );
    const firstTimed = spokenGroups
      .flatMap((group) => group.occurrences)
      .filter((occurrence) => occurrence.start !== undefined)
      .sort((left, right) => (left.start ?? 0) - (right.start ?? 0))[0];
    const heard = spokenGroups.map((group) => group.heard);
    const heardKeys = new Set(spokenGroups.map((group) => pronunciationKey(group.heard)));
    const agreed = pronunciationKey(entry.respell ?? "");
    const spelling = pronunciationKey(entry.spelling);

    let status: PronunciationCheckStatus;
    if (!entry.respell?.trim()) {
      status = "undecided";
    } else if (report.checkedOccurrences === 0 || heard.length === 0) {
      status = "unheard";
    } else if (heardKeys.size > 1) {
      status = "inconsistent";
    } else if ([...heardKeys].every((key) => key === agreed)) {
      status = "matches";
    } else if (agreed !== spelling && [...heardKeys].every((key) => key === spelling)) {
      status = "unverified";
    } else {
      status = "review";
    }

    return [{
      entryId: entry.id,
      spelling: entry.spelling,
      ...(entry.respell?.trim() ? { respell: entry.respell.trim() } : {}),
      status,
      heard,
      occurrenceCount: report.totalOccurrences,
      checkedCount: report.checkedOccurrences,
      ...(firstTimed?.start !== undefined ? { start: firstTimed.start } : {}),
      ...(firstTimed?.end !== undefined ? { end: firstTimed.end } : {}),
    }];
  });
}

function pronunciationKey(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
