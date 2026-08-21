import { alignManuscriptTokens, type TranscriptWord } from "./align";
import { spokenPieces, tokenizeManuscript } from "./normalize";

export interface ChapterSource {
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  manuscript: string;
  /** Absent when the chapter has not been checked against audio yet. */
  transcript?: TranscriptWord[];
}

export interface Occurrence {
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  /** Character offset of the word in the chapter text. */
  offset: number;
  /** A short window of surrounding manuscript text. */
  context: string;
  /** What the recogniser reported here, or "" when the chapter has no audio. */
  heard: string;
  start?: number;
  end?: number;
  /** How this reading was grouped, so like readings sort together. */
  readingKey: string;
}

export interface ReadingGroup {
  /** A representative of how the word was heard, as reported. */
  heard: string;
  count: number;
  occurrences: Occurrence[];
}

export interface BookScanReport {
  word: string;
  totalOccurrences: number;
  /** Occurrences in chapters that have been checked against audio. */
  checkedOccurrences: number;
  readings: ReadingGroup[];
  chaptersWithoutAudio: string[];
  consistent: boolean;
}

const CONTEXT_RADIUS = 42;

/**
 * Find every place a word appears across the book and group the places by how
 * it was heard. A name read three ways is the thing to catch, and it is not
 * visible from a single chapter's pickup list.
 */
export function scanBookOccurrences(word: string, chapters: ChapterSource[]): BookScanReport {
  const target = spokenPieces(word);
  const report: BookScanReport = {
    word: word.trim(),
    totalOccurrences: 0,
    checkedOccurrences: 0,
    readings: [],
    chaptersWithoutAudio: [],
    consistent: true,
  };
  if (target.length === 0) {
    return report;
  }

  const groups = new Map<string, ReadingGroup>();
  const ordered = [...chapters].sort((left, right) => left.chapterIndex - right.chapterIndex);

  for (const chapter of ordered) {
    const tokens = tokenizeManuscript(chapter.manuscript);
    const hasAudio = (chapter.transcript?.length ?? 0) > 0;
    const alignments = hasAudio
      ? alignManuscriptTokens(chapter.manuscript, chapter.transcript as TranscriptWord[])
      : [];
    if (!hasAudio) {
      report.chaptersWithoutAudio.push(chapter.chapterTitle);
    }

    const pieces = flattenPieces(tokens);
    for (const match of findMatches(pieces, target)) {
      const first = tokens[match.firstToken];
      const last = tokens[match.lastToken];
      const heard = hasAudio
        ? heardAcross(alignments, match.firstToken, match.lastToken - match.firstToken + 1)
        : "";
      const occurrence: Occurrence = {
        chapterId: chapter.chapterId,
        chapterTitle: chapter.chapterTitle,
        chapterIndex: chapter.chapterIndex,
        offset: first.start,
        context: contextAround(chapter.manuscript, first.start, last.end),
        heard,
        start: hasAudio ? alignments[match.firstToken]?.start : undefined,
        end: hasAudio ? alignments[match.lastToken]?.end : undefined,
        readingKey: hasAudio ? readingKey(heard) : "#no-audio",
      };
      report.totalOccurrences += 1;
      if (hasAudio) {
        report.checkedOccurrences += 1;
      }
      const group = groups.get(occurrence.readingKey);
      if (group) {
        group.count += 1;
        group.occurrences.push(occurrence);
      } else {
        groups.set(occurrence.readingKey, {
          heard: hasAudio ? (heard || "(nothing heard here)") : "(not checked yet)",
          count: 1,
          occurrences: [occurrence],
        });
      }
    }
  }

  report.readings = [...groups.values()].sort((left, right) => right.count - left.count);
  // Only readings from checked audio can disagree with each other.
  const spokenReadings = report.readings.filter((group) => group.occurrences[0]?.readingKey !== "#no-audio");
  report.consistent = spokenReadings.length <= 1;
  return report;
}

interface Piece {
  value: string;
  tokenIndex: number;
  firstOfToken: boolean;
  lastOfToken: boolean;
}

function flattenPieces(tokens: ReturnType<typeof tokenizeManuscript>): Piece[] {
  const pieces: Piece[] = [];
  for (const token of tokens) {
    const parts = spokenPieces(token.text);
    parts.forEach((value, offset) => {
      pieces.push({
        value,
        tokenIndex: token.index,
        firstOfToken: offset === 0,
        lastOfToken: offset === parts.length - 1,
      });
    });
  }
  return pieces;
}

/**
 * Search the spoken pieces, so "half-empty" can be searched as written while a
 * search for "half" alone does not match inside it. A match has to start and
 * end on whole manuscript words.
 */
function findMatches(pieces: Piece[], target: string[]): Array<{ firstToken: number; lastToken: number }> {
  const matches: Array<{ firstToken: number; lastToken: number }> = [];
  for (let index = 0; index + target.length <= pieces.length; index += 1) {
    if (!pieces[index].firstOfToken || !pieces[index + target.length - 1].lastOfToken) {
      continue;
    }
    let matched = true;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (pieces[index + offset].value !== target[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      matches.push({
        firstToken: pieces[index].tokenIndex,
        lastToken: pieces[index + target.length - 1].tokenIndex,
      });
    }
  }
  return matches;
}

function heardAcross(
  alignments: Array<{ heard: string }>,
  index: number,
  length: number,
): string {
  const parts: string[] = [];
  for (let offset = 0; offset < length; offset += 1) {
    const heard = alignments[index + offset]?.heard ?? "";
    // Tokens covered by one spoken figure all report the same text; do not
    // repeat it.
    if (heard !== "" && parts[parts.length - 1] !== heard) {
      parts.push(heard);
    }
  }
  return parts.join(" ");
}

/** Group readings by sound so casing and punctuation do not split a group. */
function readingKey(heard: string): string {
  const pieces = spokenPieces(heard);
  return pieces.length === 0 ? "#silent" : pieces.join(" ");
}

function contextAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - CONTEXT_RADIUS);
  const to = Math.min(text.length, end + CONTEXT_RADIUS);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to).replace(/\s+/gu, " ").trim()}${suffix}`;
}
