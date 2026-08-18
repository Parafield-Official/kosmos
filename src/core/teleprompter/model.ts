import type { ChapterFile, GlossaryEntry, ScriptSpan } from "../project/types";
import { hideMarkdownHeadingMarkers } from "../manuscript/split";

export type PromptSegment = ScriptSpan;
export type PromptTheme = "dark" | "sepia" | "cream";

export interface PromptLine {
  index: number;
  text: string;
  segments: PromptSegment[];
}

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
