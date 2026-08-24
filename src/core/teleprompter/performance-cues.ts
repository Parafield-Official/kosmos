import type { PerformanceCue, ScriptSpan } from "../project/types";
import { promptTextTokens } from "./model";

export interface PromptPerformanceCue {
  id: string;
  wordIndex: number;
  lineIndex: number;
  cue: PerformanceCue;
}

/** Attach, replace, or remove a narrator cue without changing manuscript text. */
export function applyPerformanceCue(
  spans: ScriptSpan[],
  targetWordIndex: number,
  cue: PerformanceCue | null,
): ScriptSpan[] {
  const target = Math.max(0, Math.floor(targetWordIndex));
  const output: ScriptSpan[] = [];
  let wordIndex = 0;
  for (const span of spans) {
    for (const token of promptTextTokens(span.text)) {
      const performanceCue = token.isWord
        ? (wordIndex === target ? cue ?? undefined : span.performance_cue)
        : undefined;
      appendCompatibleSpan(output, {
        ...span,
        text: token.text,
        style: [...span.style],
        ...(performanceCue ? { performance_cue: { ...performanceCue } } : {}),
      }, performanceCue !== undefined);
      if (token.isWord) {
        wordIndex += 1;
      }
    }
  }
  return output;
}

/** List all persisted cues with their global manuscript word and paragraph. */
export function performanceCuesFromSpans(spans: ScriptSpan[]): PromptPerformanceCue[] {
  const cues: PromptPerformanceCue[] = [];
  let wordIndex = 0;
  let lineIndex = 0;
  for (const span of spans) {
    for (const token of promptTextTokens(span.text)) {
      if (token.isWord) {
        if (span.performance_cue) {
          cues.push({
            id: `cue-${wordIndex}`,
            wordIndex,
            lineIndex,
            cue: { ...span.performance_cue },
          });
        }
        wordIndex += 1;
      }
      lineIndex += (token.text.match(/\n/gu) ?? []).length;
    }
  }
  return cues;
}

export function performanceCueLabel(cue: PerformanceCue): string {
  const kind = cue.kind === "beat"
    ? "Beat"
    : cue.kind === "breath"
      ? "Breath"
      : cue.kind === "emphasis"
        ? "Emphasis"
        : cue.kind === "character"
          ? "Character"
          : "Intention";
  return cue.label?.trim() ? `${kind}: ${cue.label.trim()}` : kind;
}

export function performanceCueSymbol(cue: PerformanceCue): string {
  if (cue.kind === "beat") return "／";
  if (cue.kind === "breath") return "◡";
  if (cue.kind === "emphasis") return "↑";
  if (cue.kind === "character") return "◉";
  return "✦";
}

/** Find the next unread cue when it is close enough to prepare without cluttering the page. */
export function nextPerformanceCueByRows(
  cues: PromptPerformanceCue[],
  cursor: number,
  wordTops: Array<number | null>,
  maxRowsAhead = 2,
): { cue: PromptPerformanceCue; rowsAhead: number } | null {
  const currentTop = wordTops[Math.max(0, cursor)] ?? null;
  const visibleRows = [...new Set(wordTops.filter((top): top is number => top !== null))].sort((left, right) => left - right);
  const currentRow = currentTop === null
    ? 0
    : Math.max(0, visibleRows.findIndex((top) => Math.abs(top - currentTop) < 1));
  for (const cue of cues) {
    if (cue.wordIndex < cursor) continue;
    const cueTop = wordTops[cue.wordIndex] ?? null;
    if (cueTop === null) continue;
    const cueRow = visibleRows.findIndex((top) => Math.abs(top - cueTop) < 1);
    if (cueRow < 0) continue;
    const rowsAhead = Math.max(0, cueRow - currentRow);
    return rowsAhead <= maxRowsAhead ? { cue, rowsAhead } : null;
  }
  return null;
}

function appendCompatibleSpan(output: ScriptSpan[], span: ScriptSpan, keepCue: boolean): void {
  const next = keepCue ? span : withoutCue(span);
  const previous = output.at(-1);
  if (previous && sameSpanMetadata(previous, next)) {
    previous.text += next.text;
    return;
  }
  output.push(next);
}

function withoutCue(span: ScriptSpan): ScriptSpan {
  const { performance_cue: _cue, ...rest } = span;
  return rest;
}

function sameSpanMetadata(left: ScriptSpan, right: ScriptSpan): boolean {
  return left.seat === right.seat
    && left.dialogue === right.dialogue
    && left.glossary_id === right.glossary_id
    && JSON.stringify(left.style) === JSON.stringify(right.style)
    && JSON.stringify(left.performance_cue) === JSON.stringify(right.performance_cue);
}
