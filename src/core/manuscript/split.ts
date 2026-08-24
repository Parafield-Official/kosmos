import type { ScriptSpan } from "../project/types";

/**
 * Deterministic, local manuscript chapter splitting.
 *
 * The original manuscript should still be kept in the project folder. These
 * helpers intentionally operate on plain text and never call a network or an
 * LLM. Heading lines become chapter titles; the text after a heading becomes
 * that chapter's body. Whitespace at the edges of a body is formatting noise,
 * while all interior text is preserved byte-for-byte (after CRLF is mapped to
 * LF for consistent cross-platform chapter files).
 */

export const WORDS_PER_HOUR = 9_300;
export const MAX_CHAPTER_MINUTES = 120;

export interface ManuscriptChapter {
  id: string;
  index: number;
  title: string;
  text: string;
  word_count: number;
  estimated_duration_minutes: number;
  over_120_minutes: boolean;
  /** Character offsets in the normalized source, useful for an import UI. */
  source_start: number;
  source_end: number;
  /** Exact body range in the normalized source; heading text is excluded. */
  content_start: number;
  content_end: number;
}

export interface SplitManuscriptOptions {
  defaultTitle?: string;
  idPrefix?: string;
  maxChapterMinutes?: number;
  /** Treat every line beginning with # as a chapter heading (plain text books). */
  hashStartsChapter?: boolean;
}

export interface PastedChapter {
  title: string;
  text: string;
}

/** Replace Markdown heading markers with same-length spaces for clean display. */
export function hideMarkdownHeadingMarkers(source: string): string {
  return source
    .replace(/^([\t ]{0,3})(#{1,6})(?=[\t ]+)/gmu, (_match, indentation, markers) => `${indentation}${" ".repeat(markers.length)}`)
    .replace(/([\t ]+)(#{1,6})(?=[\t ]*$)/gmu, (_match, spacing, markers) => `${spacing}${" ".repeat(markers.length)}`);
}

interface Heading {
  lineIndex: number;
  title: string;
}

/** Estimate narrated minutes using the ACX planning rate from the build spec. */
export function estimateDurationMinutes(wordCount: number): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) {
    return 0;
  }
  return (wordCount / WORDS_PER_HOUR) * 60;
}

/** Count words without trying to interpret punctuation or dialogue. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/**
 * Split a plain-text manuscript into chapters. A document with no recognized
 * heading becomes one chapter, which is the safe P0 fallback.
 */
export function splitManuscript(
  source: string,
  options: SplitManuscriptOptions = {},
): ManuscriptChapter[] {
  const sourceNormalized = source.replace(/\r\n?/g, "\n");
  const normalized = hideMarkdownHeadingMarkers(sourceNormalized);
  if (normalized.trim().length === 0) {
    return [];
  }

  const sourceLines = sourceNormalized.split("\n");
  const lines = normalized.split("\n");
  let hashHeadingNumber = 0;
  const headings = lines.flatMap((line, lineIndex) => {
    const hashTitle = options.hashStartsChapter
      ? hashHeadingTitle(sourceLines[lineIndex], hashHeadingNumber + 1)
      : null;
    if (hashTitle) {
      hashHeadingNumber += 1;
    }
    const title = hashTitle ?? headingTitle(line, lineIndex, lines);
    return title ? [{ lineIndex, title }] : [];
  });
  const maxMinutes = options.maxChapterMinutes ?? MAX_CHAPTER_MINUTES;
  const idPrefix = options.idPrefix ?? "ch";

  if (headings.length === 0) {
    return [makeChapter({
      id: `${idPrefix}01`,
      index: 1,
      title: options.defaultTitle ?? "Chapter 1",
      text: normalized.trim(),
      sourceStart: firstNonWhitespaceOffset(normalized),
      sourceEnd: lastNonWhitespaceEnd(normalized),
      contentStart: firstNonWhitespaceOffset(normalized),
      contentEnd: lastNonWhitespaceEnd(normalized),
      maxMinutes,
    })];
  }

  const chapters: ManuscriptChapter[] = [];
  const firstHeading = headings[0];
  const preamble = lines.slice(0, firstHeading.lineIndex).join("\n").trim();
  if (preamble.length > 0) {
    const preambleStart = firstNonWhitespaceOffset(normalized);
    const headingStart = lineStartOffset(lines, firstHeading.lineIndex);
    chapters.push(
      makeChapter({
        id: `${idPrefix}${String(chapters.length + 1).padStart(2, "0")}`,
        index: chapters.length + 1,
        title: "Front matter",
        text: preamble,
        sourceStart: preambleStart,
        sourceEnd: Math.max(preambleStart, headingStart - 1),
        contentStart: preambleStart,
        contentEnd: preambleStart + preamble.length,
        maxMinutes,
      }),
    );
  }

  headings.forEach((heading, headingPosition) => {
    const nextHeading = headings[headingPosition + 1];
    const bodyStartLine = heading.lineIndex + 1;
    const bodyEndLine = nextHeading?.lineIndex ?? lines.length;
    const rawBody = lines.slice(bodyStartLine, bodyEndLine).join("\n");
    const text = rawBody.trim();
    const headingStart = lineStartOffset(lines, heading.lineIndex);
    const bodyStart = lineStartOffset(lines, bodyStartLine);
    const bodyEnd = nextHeading
      ? Math.max(bodyStart, lineStartOffset(lines, nextHeading.lineIndex) - 1)
      : normalized.length;
    const leadingWhitespace = rawBody.match(/^\s*/u)?.[0].length ?? 0;
    const contentStart = Math.min(bodyEnd, bodyStart + leadingWhitespace);
    const contentEnd = Math.max(contentStart, bodyStart + rawBody.trimEnd().length);

    chapters.push(
      makeChapter({
        id: `${idPrefix}${String(chapters.length + 1).padStart(2, "0")}`,
        index: chapters.length + 1,
        title: heading.title,
        text,
        sourceStart: headingStart,
        sourceEnd: Math.max(headingStart, bodyEnd),
        contentStart,
        contentEnd,
        maxMinutes,
      }),
    );
  });

  return chapters;
}

/**
 * Normalize text pasted into the single-chapter composer. A leading Markdown
 * or named chapter heading becomes the title instead of narration text. A
 * multi-chapter paste is rejected so authors do not silently lose chapters;
 * the manuscript importer should be used for a complete book.
 */
export function parsePastedChapter(source: string, fallbackTitle = "Chapter 1"): PastedChapter {
  const normalizedFallback = fallbackTitle.trim() || "Chapter 1";
  const chapters = splitManuscript(source, { defaultTitle: normalizedFallback, hashStartsChapter: true });
  const bodyChapters = chapters.filter((chapter) => chapter.title !== "Front matter");
  if (bodyChapters.length > 1) {
    throw new Error("Paste one chapter at a time. Use Import manuscript for a complete book.");
  }
  const chapter = bodyChapters[0];
  if (chapter) {
    return { title: chapter.title, text: chapter.text };
  }
  return { title: normalizedFallback, text: source.replace(/\r\n?/g, "\n").trim() };
}

/** Rename a chapter without changing its body or source offsets. */
export function renameChapter(chapter: ManuscriptChapter, title: string): ManuscriptChapter {
  const cleanTitle = title.trim();
  if (cleanTitle.length === 0) {
    throw new Error("Chapter title cannot be empty");
  }
  return { ...chapter, title: cleanTitle };
}

/**
 * Manually split a chapter at a character offset. The split is exact: no
 * separator is invented or discarded, so concatenating the two bodies gives
 * the original body exactly.
 */
export function splitChapterAt(
  chapter: ManuscriptChapter,
  offset: number,
  secondTitle = `${chapter.title} (continued)`,
): [ManuscriptChapter, ManuscriptChapter] {
  if (!Number.isInteger(offset) || offset <= 0 || offset >= chapter.text.length) {
    throw new Error("Manual split offset must be inside the chapter text");
  }
  const leftText = chapter.text.slice(0, offset);
  const rightText = chapter.text.slice(offset);
  const left = makeChapter({
    ...chapter,
    title: chapter.title,
    text: leftText,
    sourceStart: chapter.source_start,
    sourceEnd: chapter.source_start + offset - 1,
    contentStart: chapter.content_start,
    contentEnd: chapter.content_start + offset,
    maxMinutes: MAX_CHAPTER_MINUTES,
  });
  const right = makeChapter({
    ...chapter,
    id: `${chapter.id}-b`,
    title: secondTitle,
    text: rightText,
    sourceStart: chapter.source_start + offset,
    sourceEnd: chapter.source_end,
    contentStart: chapter.content_start + offset,
    contentEnd: chapter.content_end,
    maxMinutes: MAX_CHAPTER_MINUTES,
  });
  return [left, right];
}

/** Merge two manually selected chapters while preserving their text order. */
export function mergeChapters(
  first: ManuscriptChapter,
  second: ManuscriptChapter,
  title = first.title,
): ManuscriptChapter {
  const mergedText = first.text + second.text;
  return makeChapter({
    ...first,
    title,
    text: mergedText,
    sourceStart: Math.min(first.source_start, second.source_start),
    sourceEnd: Math.max(first.source_end, second.source_end),
    contentStart: Math.min(first.content_start, second.content_start),
    contentEnd: Math.max(first.content_end, second.content_end),
    maxMinutes: MAX_CHAPTER_MINUTES,
  });
}

function makeChapter(input: {
  id: string;
  index: number;
  title: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  contentStart: number;
  contentEnd: number;
  maxMinutes: number;
}): ManuscriptChapter {
  const wordCount = countWords(input.text);
  const estimated = estimateDurationMinutes(wordCount);
  return {
    id: input.id,
    index: input.index,
    title: input.title.trim() || `Chapter ${input.index}`,
    text: input.text,
    word_count: wordCount,
    estimated_duration_minutes: estimated,
    over_120_minutes: estimated > input.maxMinutes,
    source_start: input.sourceStart,
    source_end: input.sourceEnd,
    content_start: input.contentStart,
    content_end: input.contentEnd,
  };
}

/** Slice styled manuscript spans by normalized source offsets without flattening styles. */
export function sliceScriptSpans(
  spans: ScriptSpan[],
  start: number,
  end: number,
): ScriptSpan[] {
  if (end <= start) {
    return [];
  }
  const result: ScriptSpan[] = [];
  let cursor = 0;
  for (const span of spans) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    const overlapStart = Math.max(start, spanStart);
    const overlapEnd = Math.min(end, spanEnd);
    if (overlapEnd <= overlapStart) {
      continue;
    }
    const text = span.text.slice(overlapStart - spanStart, overlapEnd - spanStart);
    if (text.length === 0) {
      continue;
    }
    const previous = result.at(-1);
    if (
      previous
      && previous.seat === span.seat
      && previous.dialogue === span.dialogue
      && JSON.stringify(previous.style) === JSON.stringify(span.style)
      && previous.glossary_id === span.glossary_id
      && JSON.stringify(previous.performance_cue) === JSON.stringify(span.performance_cue)
    ) {
      previous.text += text;
    } else {
      result.push({ ...span, text, style: [...span.style] });
    }
  }
  return result;
}

function lineStartOffset(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

function firstNonWhitespaceOffset(value: string): number {
  const match = /\S/.exec(value);
  return match?.index ?? 0;
}

function lastNonWhitespaceEnd(value: string): number {
  let end = value.length;
  while (end > 0 && /\s/.test(value[end - 1])) {
    end -= 1;
  }
  return end;
}

function headingTitle(line: string, lineIndex: number, lines: string[]): string | null {
  const rawCandidate = line.trim();
  const markdownHeading = /^#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?$/u.exec(rawCandidate);
  const candidate = (markdownHeading?.[1] ?? rawCandidate).trim();
  if (candidate.length === 0 || candidate.length > 140) {
    return null;
  }

  // The named headings in the spec are intentionally permissive about a
  // subtitle and punctuation, but require a word boundary after the name.
  if (/^(?:chapter\b.*|prologue\b.*|epilogue\b.*|opening\s+credits?\b.*|closing\s+credits?\b.*)$/i.test(candidate)) {
    return candidate;
  }

  // Numbered headings are only accepted when visually isolated. This avoids
  // turning ordinary numbered prose/list items into chapters.
  if (/^\d{1,3}(?:[.)]|\s*[-—:]\s*|$)(?:\s*\S.*)?$/.test(candidate)) {
    const previousBlank = lineIndex === 0 || lines[lineIndex - 1].trim() === "";
    const nextBlank = lineIndex === lines.length - 1 || lines[lineIndex + 1].trim() === "";
    return previousBlank && nextBlank ? candidate : null;
  }

  return null;
}

function hashHeadingTitle(line: string | undefined, fallbackNumber: number): string | null {
  if (line === undefined) {
    return null;
  }
  const match = /^[\t ]{0,3}#{1,6}(?:[\t ]+(.+?))?[\t ]*$/u.exec(line);
  if (!match) {
    return null;
  }
  const title = (match[1] ?? "")
    .replace(/[\t ]+#{1,6}[\t ]*$/u, "")
    .trim();
  return title || `Chapter ${fallbackNumber}`;
}
