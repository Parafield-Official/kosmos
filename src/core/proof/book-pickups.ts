import type { Pickup } from "../project/types";
import { spokenPieces } from "./normalize";

export interface BookPickupChapter {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  hasAudio: boolean;
  /** Empty when the chapter has not been checked against its audio yet. */
  pickups: Pickup[];
  /** Whether a proof pass has been saved for this chapter. */
  checked: boolean;
}

export interface BookPickupRow {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  pickup: Pickup;
}

export interface ChapterProgress {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  hasAudio: boolean;
  checked: boolean;
  open: number;
  resolved: number;
  total: number;
}

/** A word flagged in more than one place, which is usually one decision. */
export interface RepeatedWord {
  word: string;
  count: number;
  chapters: number;
  rows: BookPickupRow[];
}

export interface BookPickupSummary {
  chapters: ChapterProgress[];
  open: BookPickupRow[];
  openCount: number;
  resolvedCount: number;
  byKind: Record<Pickup["kind"], number>;
  repeated: RepeatedWord[];
  /** Chapters with audio that have never been checked. */
  uncheckedChapters: ChapterProgress[];
}

/**
 * Roll every chapter's saved pickups into one worklist. Narrators work through
 * a book, not a chapter: what is left to fix, and which flags are the same word
 * over and over, cannot be seen one chapter at a time.
 */
export function summarizeBookPickups(chapters: BookPickupChapter[]): BookPickupSummary {
  const ordered = [...chapters].sort((left, right) => left.chapterIndex - right.chapterIndex);
  const progress: ChapterProgress[] = [];
  const open: BookPickupRow[] = [];
  const byKind: Record<Pickup["kind"], number> = { skip: 0, insert: 0, sub: 0, pause: 0 };
  let resolvedCount = 0;

  for (const chapter of ordered) {
    let chapterOpen = 0;
    let chapterResolved = 0;
    for (const pickup of chapter.pickups) {
      if (pickup.status === "open") {
        chapterOpen += 1;
        byKind[pickup.kind] += 1;
        open.push({
          chapterId: chapter.chapterId,
          chapterIndex: chapter.chapterIndex,
          chapterTitle: chapter.chapterTitle,
          pickup,
        });
      } else {
        chapterResolved += 1;
      }
    }
    resolvedCount += chapterResolved;
    progress.push({
      chapterId: chapter.chapterId,
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      hasAudio: chapter.hasAudio,
      checked: chapter.checked,
      open: chapterOpen,
      resolved: chapterResolved,
      total: chapter.pickups.length,
    });
  }

  open.sort((left, right) => left.chapterIndex - right.chapterIndex
    || left.pickup.t_start - right.pickup.t_start);

  return {
    chapters: progress,
    open,
    openCount: open.length,
    resolvedCount,
    byKind,
    repeated: repeatedWords(open),
    uncheckedChapters: progress.filter((chapter) => chapter.hasAudio && !chapter.checked),
  };
}

/**
 * Fold one decision made elsewhere into an already-loaded worklist.
 *
 * The chapter list and the whole-book list are on screen together, so settling
 * a flag in one has to settle it in the other. Re-reading every chapter from
 * disk for a single click would be wasteful and would make the list flicker.
 */
export function reflectPickupDecision(
  summary: BookPickupSummary,
  pickup: Pickup,
  chapter: { chapterId: string; chapterIndex: number; chapterTitle: string },
): BookPickupSummary {
  const wasOpen = summary.open.some((row) => row.pickup.id === pickup.id);
  const isOpen = pickup.status === "open";
  if (wasOpen === isOpen) {
    // Same side of the line: only the stored copy of the flag changed.
    const open = summary.open.map((row) => row.pickup.id === pickup.id ? { ...row, pickup } : row);
    return { ...summary, open, repeated: repeatedWords(open) };
  }

  const open = summary.open.filter((row) => row.pickup.id !== pickup.id);
  if (isOpen) {
    open.push({ ...chapter, pickup });
    open.sort((left, right) => left.chapterIndex - right.chapterIndex
      || left.pickup.t_start - right.pickup.t_start);
  }

  const step = isOpen ? 1 : -1;
  const byKind = { ...summary.byKind };
  byKind[pickup.kind] = Math.max(0, byKind[pickup.kind] + step);

  return {
    ...summary,
    open,
    openCount: open.length,
    resolvedCount: Math.max(0, summary.resolvedCount - step),
    byKind,
    repeated: repeatedWords(open),
    chapters: summary.chapters.map((progress) => progress.chapterId === chapter.chapterId
      ? {
        ...progress,
        open: Math.max(0, progress.open + step),
        resolved: Math.max(0, progress.resolved - step),
      }
      : progress),
  };
}

/**
 * Group open flags by the written word behind them. A name flagged in nine
 * places is one decision — fix the pronunciation, or filter the word — and
 * seeing the nine together is what makes that obvious.
 */
function repeatedWords(rows: BookPickupRow[]): RepeatedWord[] {
  const groups = new Map<string, { word: string; rows: BookPickupRow[]; chapters: Set<string> }>();
  for (const row of rows) {
    // An insert has nothing written behind it, so group those by what was said.
    const source = row.pickup.expected.trim() || row.pickup.heard.trim();
    const key = spokenPieces(source).join(" ");
    if (key === "") {
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      group.chapters.add(row.chapterId);
      continue;
    }
    groups.set(key, { word: source, rows: [row], chapters: new Set([row.chapterId]) });
  }
  return [...groups.values()]
    .filter((group) => group.rows.length > 1)
    .map((group) => ({
      word: group.word,
      count: group.rows.length,
      chapters: group.chapters.size,
      rows: group.rows,
    }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word));
}
