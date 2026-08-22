import type { ChapterFile, GlossaryEntry, ScriptSpan } from "../project/types";
import { hideMarkdownHeadingMarkers } from "../manuscript/split";

export type PromptSegment = ScriptSpan;
export type PromptTheme = "dark" | "sepia" | "cream";

export interface PromptLine {
  index: number;
  text: string;
  segments: PromptSegment[];
}

export interface PromptTextToken {
  text: string;
  isWord: boolean;
}

const PROMPT_WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export interface LiveFlagsState {
  enabled: boolean;
  dimmed: boolean;
  falseAlarmCount: number;
  dismissedIds: string[];
}

export interface BookDashboardStats {
  chapterCount: number;
  wordCount: number;
  estimatedMinutes: number;
  recordedCount: number;
  proofedCount: number;
  openPickups: number;
}

export interface PromptChapterStatus {
  label: string;
  tone: "idle" | "recorded" | "review" | "ready";
}

export interface TeleprompterLayout {
  teleprompterOpen: boolean;
  studioNavOpen: boolean;
}

export function teleprompterLayout(open: boolean): TeleprompterLayout {
  return {
    teleprompterOpen: open,
    studioNavOpen: !open,
  };
}

export function bookDashboardStats(chapters: ChapterFile[]): BookDashboardStats {
  const totals = chapters.reduce((result, chapter) => {
    const words = Math.max(0, chapter.word_count ?? 0);
    const minutes = chapter.estimated_duration_minutes && chapter.estimated_duration_minutes > 0
      ? chapter.estimated_duration_minutes
      : words / 155;
    return {
      wordCount: result.wordCount + words,
      estimatedMinutes: result.estimatedMinutes + minutes,
      recordedCount: result.recordedCount + (chapter.audio_path ? 1 : 0),
      proofedCount: result.proofedCount + (chapter.audio_path && chapter.open_pickups === 0 ? 1 : 0),
      openPickups: result.openPickups + Math.max(0, chapter.open_pickups ?? 0),
    };
  }, { wordCount: 0, estimatedMinutes: 0, recordedCount: 0, proofedCount: 0, openPickups: 0 });

  return {
    chapterCount: chapters.length,
    wordCount: totals.wordCount,
    estimatedMinutes: Math.round(totals.estimatedMinutes * 10) / 10,
    recordedCount: totals.recordedCount,
    proofedCount: totals.proofedCount,
    openPickups: totals.openPickups,
  };
}

export function filterPromptChapters(chapters: ChapterFile[], query: string): ChapterFile[] {
  const normalized = query.trim().toLocaleLowerCase("en-US");
  return [...chapters]
    .sort((left, right) => left.index - right.index)
    .filter((chapter) => {
      if (!normalized) {
        return true;
      }
      const padded = String(chapter.index).padStart(2, "0");
      return chapter.title.toLocaleLowerCase("en-US").includes(normalized)
        || String(chapter.index) === normalized
        || padded.includes(normalized);
    });
}

export function promptChapterStatus(chapter: ChapterFile): PromptChapterStatus {
  if (!chapter.audio_path) {
    return { label: "Needs recording", tone: "idle" };
  }
  if ((chapter.open_pickups ?? 0) > 0) {
    const count = chapter.open_pickups ?? 0;
    return { label: `${count} pickup${count === 1 ? "" : "s"}`, tone: "review" };
  }
  if (chapter.open_pickups === 0) {
    return { label: "Proofed", tone: "ready" };
  }
  return { label: "Recorded", tone: "recorded" };
}

export function relevantPromptGlossary(spans: ScriptSpan[], glossary: GlossaryEntry[]): GlossaryEntry[] {
  const linkedIds = new Set(spans.flatMap((span) => span.glossary_id ? [span.glossary_id] : []));
  const manuscript = spans.map((span) => span.text).join(" ").toLocaleLowerCase("en-US");
  return glossary.filter((entry) => linkedIds.has(entry.id)
    || manuscript.includes(entry.spelling.toLocaleLowerCase("en-US")));
}

export function readingProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  if (maximum === 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, scrollTop / maximum));
}

export function liveCursorForVisibleLine(
  scrollTop: number,
  lines: Array<{ top: number; height: number; wordStart: number }>,
): number {
  const visibleTop = Math.max(0, scrollTop);
  const visible = lines.find((line) => line.top + Math.max(1, line.height) > visibleTop + 8);
  return Math.max(0, visible?.wordStart ?? lines[0]?.wordStart ?? 0);
}

/** Split text into renderable pieces while retaining every space and mark. */
export function promptTextTokens(text: string): PromptTextToken[] {
  const source = String(text ?? "");
  const tokens: PromptTextToken[] = [];
  let offset = 0;
  for (const match of source.matchAll(PROMPT_WORD_PATTERN)) {
    const start = match.index ?? offset;
    if (start > offset) {
      tokens.push({ text: source.slice(offset, start), isWord: false });
    }
    tokens.push({ text: match[0], isWord: true });
    offset = start + match[0].length;
  }
  if (offset < source.length) {
    tokens.push({ text: source.slice(offset), isWord: false });
  }
  return tokens;
}

export function promptWordCount(text: string): number {
  return promptTextTokens(text).filter((token) => token.isWord).length;
}

export function liveHighlightWordIndex(cursor: number, enabled: boolean): number {
  if (!enabled || !Number.isFinite(cursor) || cursor < 0) {
    return -1;
  }
  return Math.floor(cursor);
}

/**
 * How much of the script the follow highlight covers.
 *
 * "line" means one visual row of wrapped text, which is what a narrator sees as
 * a line — not a manuscript line. A manuscript line is a whole prose paragraph
 * here, so it is what "paragraph" covers.
 */
export type PromptHighlightMode = "word" | "line" | "paragraph";

/** An inclusive span of global word indexes. */
export interface PromptWordRange {
  from: number;
  to: number;
}

/**
 * Group a paragraph's words into visual rows using each word's measured
 * vertical position. The browser decides where text wraps, so rows can only be
 * discovered by measurement; words sharing a row share a top edge.
 *
 * `tops` is indexed from `firstWord`. Words that could not be measured extend
 * the row in progress rather than starting a new one, so a missing measurement
 * degrades the band's length instead of splitting it in the wrong place.
 */
export function promptWordRows(firstWord: number, tops: Array<number | null>): PromptWordRange[] {
  const rows: PromptWordRange[] = [];
  let rowTop: number | null = null;
  for (let offset = 0; offset < tops.length; offset += 1) {
    const index = firstWord + offset;
    const top = tops[offset];
    const last = rows.at(-1);
    // Half a line of tolerance: subpixel layout and mixed font sizes shift a
    // word's top slightly without moving it to another row.
    const sameRow = last !== undefined
      && (top === null || rowTop === null || Math.abs(top - rowTop) < 4);
    if (sameRow) {
      last.to = index;
      continue;
    }
    rows.push({ from: index, to: index });
    rowTop = top;
  }
  return rows;
}

/** The row containing `wordIndex`, or null when it falls outside every row. */
export function promptRowAt(rows: PromptWordRange[], wordIndex: number): PromptWordRange | null {
  return rows.find((row) => wordIndex >= row.from && wordIndex <= row.to) ?? null;
}

/**
 * The word range the band should cover, or null when nothing should be banded.
 *
 * Word mode returns null because a single word is highlighted directly rather
 * than banded. Line mode also returns null until the active paragraph's rows
 * have been measured, which costs one frame at a paragraph boundary and avoids
 * flashing a paragraph-wide band before it narrows to a row.
 */
export function promptHighlightRange(input: {
  mode: PromptHighlightMode;
  wordIndex: number;
  paragraphFirstWord: number | undefined;
  paragraphWordCount: number;
  rows: PromptWordRange[];
}): PromptWordRange | null {
  const { mode, wordIndex, paragraphFirstWord, paragraphWordCount, rows } = input;
  if (mode === "word" || wordIndex < 0 || paragraphFirstWord === undefined) {
    return null;
  }
  if (mode === "line") {
    return promptRowAt(rows, wordIndex);
  }
  return paragraphWordCount > 0
    ? { from: paragraphFirstWord, to: paragraphFirstWord + paragraphWordCount - 1 }
    : null;
}

/**
 * Should this token carry the band highlight?
 *
 * `wordsBefore` is how many of the paragraph's words have already been emitted,
 * so a word token is at that index and a spacing token sits just after it.
 * Including spacing that falls between two banded words is what makes the band
 * read as one continuous stripe rather than a row of separate word chips.
 */
export function promptBandCovers(
  range: PromptWordRange | null,
  wordsBefore: number,
  isWord: boolean,
): boolean {
  if (!range) {
    return false;
  }
  return isWord
    ? wordsBefore >= range.from && wordsBefore <= range.to
    : wordsBefore > range.from && wordsBefore <= range.to;
}

export function remainingReadTimeLabel(totalMinutes: number, progress: number): string {
  const safeProgress = Math.min(1, Math.max(0, progress));
  if (safeProgress >= 1) {
    return "Chapter complete";
  }
  const remaining = Math.max(0, totalMinutes) * (1 - safeProgress);
  if (remaining < 1) {
    return "Under a minute";
  }
  return `${Math.max(1, Math.round(remaining))}m left`;
}

/** Split script spans into renderable lines without dropping style metadata. */
export function buildPromptLines(spans: ScriptSpan[]): PromptLine[] {
  const lines: PromptLine[] = [{ index: 0, text: "", segments: [] }];
  for (const span of spans) {
    const pieces = span.text.split("\n");
    pieces.forEach((piece, pieceIndex) => {
      if (piece.length > 0) {
        appendSegment(lines.at(-1)!, { ...span, text: piece, style: [...span.style] });
      }
      if (pieceIndex < pieces.length - 1) {
        lines.push({ index: lines.length, text: "", segments: [] });
      }
    });
  }
  // Keep intentional blank paragraphs in the middle of a manuscript. Only the
  // synthetic trailing line created by a final newline is removed.
  while (lines.length > 1 && lines.at(-1)?.text.length === 0) {
    lines.pop();
  }
  lines.forEach(hidePromptHeadingMarkers);
  lines.forEach((line, index) => {
    line.index = index;
  });
  return lines;
}

function hidePromptHeadingMarkers(line: PromptLine): void {
  const safeText = hideMarkdownHeadingMarkers(line.text);
  if (safeText === line.text) {
    return;
  }
  let offset = 0;
  line.segments = line.segments.map((segment) => {
    const text = safeText.slice(offset, offset + segment.text.length);
    offset += segment.text.length;
    return { ...segment, text };
  });
  line.text = safeText;
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 28;
  }
  return Math.min(96, Math.max(20, Math.round(value)));
}

export function createLiveFlagsState(): LiveFlagsState {
  return { enabled: false, dimmed: false, falseAlarmCount: 0, dismissedIds: [] };
}

export function recordLiveFlag(
  state: LiveFlagsState,
  event: { id: string; isTrueMismatch: boolean },
): LiveFlagsState {
  if (!state.enabled || state.dimmed || state.dismissedIds.includes(event.id)) {
    return state;
  }
  if (event.isTrueMismatch) {
    return state;
  }
  const falseAlarmCount = state.falseAlarmCount + 1;
  return {
    ...state,
    falseAlarmCount,
    dimmed: falseAlarmCount >= 3,
  };
}

export function dismissLiveFlag(state: LiveFlagsState, id: string): LiveFlagsState {
  if (state.dismissedIds.includes(id)) {
    return state;
  }
  const falseAlarmCount = state.falseAlarmCount + 1;
  return {
    ...state,
    dismissedIds: [...state.dismissedIds, id],
    falseAlarmCount,
    dimmed: state.dimmed || falseAlarmCount >= 3,
  };
}

function appendSegment(line: PromptLine, segment: PromptSegment): void {
  const previous = line.segments.at(-1);
  if (
    previous
    && previous.seat === segment.seat
    && previous.dialogue === segment.dialogue
    && previous.glossary_id === segment.glossary_id
    && JSON.stringify(previous.style) === JSON.stringify(segment.style)
  ) {
    previous.text += segment.text;
  } else {
    line.segments.push(segment);
  }
  line.text += segment.text;
}
