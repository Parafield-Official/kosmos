import type { Pickup, Seat } from "../project/types";
import { alignManuscriptTokens, type TranscriptWord } from "./align";
import { normalizeToken, tokenizeManuscript, type ManuscriptToken } from "./normalize";

export type NarrationRedoScope = "selection" | "sentence" | "paragraph";
export type NarrationTimingState = "ready" | "partial" | "unavailable";

export interface AlignedManuscriptToken {
  tokenIndex: number;
  written: string;
  heard: string;
  /** Canonical manuscript spelling for a match; recognized spelling for a difference. */
  display: string;
  state: "matched" | "different" | "missing";
  start?: number;
  end?: number;
}

export interface NarrationRedoRange {
  scope: NarrationRedoScope;
  fromToken: number;
  toToken: number;
  text: string;
  wordCount: number;
  timing: NarrationTimingState;
  timedWordCount: number;
  start?: number;
  end?: number;
}

export interface NarrationRedoRanges {
  selection: NarrationRedoRange;
  sentence: NarrationRedoRange;
  paragraph: NarrationRedoRange;
}

const SENTENCE_SAFE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "no",
]);

/**
 * Whisper remains independent evidence. This projection attaches that evidence
 * to the canonical manuscript tokens so headings, paragraphs, punctuation,
 * emphasis, and capitalization can continue to come from the manuscript.
 */
export function alignedManuscriptTokens(
  manuscript: string,
  transcript: TranscriptWord[],
): AlignedManuscriptToken[] {
  return alignManuscriptTokens(manuscript, transcript).map((alignment) => {
    const heard = alignment.heard.trim();
    const matched = heard.length > 0 && normalizeToken(heard) === normalizeToken(alignment.written);
    return {
      tokenIndex: alignment.tokenIndex,
      written: alignment.written,
      heard,
      display: matched || heard.length === 0 ? alignment.written : heard,
      state: heard.length === 0 ? "missing" : matched ? "matched" : "different",
      ...(alignment.start !== undefined ? { start: alignment.start } : {}),
      ...(alignment.end !== undefined ? { end: alignment.end } : {}),
    };
  });
}

export function buildNarrationRedoRanges(input: {
  manuscript: string;
  transcript: TranscriptWord[];
  fromToken: number;
  toToken: number;
}): NarrationRedoRanges {
  const tokens = tokenizeManuscript(input.manuscript);
  if (tokens.length === 0) {
    throw new Error("The manuscript has no spoken words to select.");
  }
  const from = clampToken(Math.min(input.fromToken, input.toToken), tokens.length);
  const to = clampToken(Math.max(input.fromToken, input.toToken), tokens.length);
  const aligned = alignedManuscriptTokens(input.manuscript, input.transcript);
  const sentence = sentenceTokenRange(input.manuscript, tokens, from, to);
  const paragraph = paragraphTokenRange(input.manuscript, tokens, from, to);

  return {
    selection: makeRange("selection", input.manuscript, tokens, aligned, from, to, false),
    sentence: makeRange("sentence", input.manuscript, tokens, aligned, sentence.from, sentence.to, true),
    paragraph: makeRange("paragraph", input.manuscript, tokens, aligned, paragraph.from, paragraph.to, true),
  };
}

export function createNarratorRedoPickup(input: {
  chapterId: string;
  range: NarrationRedoRange;
  sourceKind: "take" | "live";
  reason?: string;
  seat?: Seat;
}): Pickup {
  if (
    input.range.timing === "unavailable"
    || input.range.start === undefined
    || input.range.end === undefined
    || input.range.end <= input.range.start
  ) {
    throw new Error("The selected text has no timed audio to replace.");
  }
  const startMillis = Math.round(input.range.start * 1000);
  const endMillis = Math.round(input.range.end * 1000);
  const reason = input.reason?.trim();
  return {
    id: `manual-${input.chapterId}-${input.range.fromToken}-${input.range.toToken}-${startMillis}-${endMillis}`,
    chapter_id: input.chapterId,
    t_start: input.range.start,
    t_end: input.range.end,
    line_start: input.range.start,
    line_end: input.range.end,
    line_text: input.range.text,
    expected: input.range.text,
    heard: input.range.text,
    kind: "sub",
    seat: input.seat ?? "narration",
    status: "open",
    confidence: input.range.timing === "ready" ? 1 : 0.5,
    intent: "performance",
    selection_kind: input.range.scope,
    source_kind: input.sourceKind,
    manuscript_index: input.range.fromToken,
    ...(reason ? { note: reason } : {}),
  };
}

function makeRange(
  scope: NarrationRedoScope,
  manuscript: string,
  tokens: ManuscriptToken[],
  aligned: AlignedManuscriptToken[],
  fromToken: number,
  toToken: number,
  includeTrailingPunctuation: boolean,
): NarrationRedoRange {
  const selected = aligned.slice(fromToken, toToken + 1);
  const timed = selected.filter((token) => token.start !== undefined && token.end !== undefined);
  const first = timed[0];
  const last = timed.at(-1);
  const timing: NarrationTimingState = timed.length === 0
    ? "unavailable"
    : timed.length === selected.length
      ? "ready"
      : "partial";
  return {
    scope,
    fromToken,
    toToken,
    text: tokenRangeText(manuscript, tokens, fromToken, toToken, includeTrailingPunctuation),
    wordCount: toToken - fromToken + 1,
    timing,
    timedWordCount: timed.length,
    ...(first?.start !== undefined ? { start: first.start } : {}),
    ...(last?.end !== undefined ? { end: last.end } : {}),
  };
}

function tokenRangeText(
  manuscript: string,
  tokens: ManuscriptToken[],
  from: number,
  to: number,
  includeTrailingPunctuation: boolean,
): string {
  const start = tokens[from].start;
  const end = includeTrailingPunctuation
    ? (tokens[to + 1]?.start ?? manuscript.length)
    : tokens[to].end;
  return manuscript
    .slice(start, end)
    .replace(/^[\t ]{0,3}#{1,6}[\t ]+/u, "")
    .replace(/\*\*|__/gu, "")
    .replace(/(?<!\*)\*(?!\*)|(?<!_)_(?!_)/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function sentenceTokenRange(
  manuscript: string,
  tokens: ManuscriptToken[],
  selectedFrom: number,
  selectedTo: number,
): { from: number; to: number } {
  let from = selectedFrom;
  while (from > 0 && !sentenceBoundaryBetween(manuscript, tokens[from - 1], tokens[from])) {
    from -= 1;
  }
  let to = selectedTo;
  while (to < tokens.length - 1 && !sentenceBoundaryBetween(manuscript, tokens[to], tokens[to + 1])) {
    to += 1;
  }
  return { from, to };
}

function sentenceBoundaryBetween(
  manuscript: string,
  previous: ManuscriptToken,
  next: ManuscriptToken,
): boolean {
  const between = manuscript.slice(previous.end, next.start);
  if (/\n/u.test(between) || /[!?…。！？]/u.test(between)) {
    return true;
  }
  return /\./u.test(between) && !SENTENCE_SAFE_ABBREVIATIONS.has(previous.value);
}

function paragraphTokenRange(
  manuscript: string,
  tokens: ManuscriptToken[],
  selectedFrom: number,
  selectedTo: number,
): { from: number; to: number } {
  const startCharacter = tokens[selectedFrom].start;
  const endCharacter = tokens[selectedTo].end;
  const before = manuscript.slice(0, startCharacter);
  const separators = [...before.matchAll(/\n\s*\n/gu)];
  const previous = separators.at(-1);
  const paragraphStart = previous && previous.index !== undefined
    ? previous.index + previous[0].length
    : 0;
  const after = manuscript.slice(endCharacter);
  const next = /\n\s*\n/gu.exec(after);
  const paragraphEnd = next?.index !== undefined ? endCharacter + next.index : manuscript.length;
  const inParagraph = tokens.filter((token) => token.start >= paragraphStart && token.end <= paragraphEnd);
  return inParagraph.length > 0
    ? { from: inParagraph[0].index, to: inParagraph.at(-1)?.index ?? selectedTo }
    : { from: selectedFrom, to: selectedTo };
}

function clampToken(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, Math.trunc(value)));
}
