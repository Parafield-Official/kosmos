import type { ScriptSpan } from "../project/types";

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
  lines.forEach((line, index) => {
    line.index = index;
  });
  return lines;
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 48;
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
