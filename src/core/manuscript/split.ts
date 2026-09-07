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
  /** Stacked parent/child headings retained for narration without empty chapters. */
  heading_text?: string;
}

export interface SplitManuscriptOptions {
  defaultTitle?: string;
  idPrefix?: string;
  maxChapterMinutes?: number;
  /** Treat every line beginning with # as a chapter heading (plain text books). */
  hashStartsChapter?: boolean;
  /**
   * Drop a Table of Contents. Many books open with a contents page that lists
   * "Chapter 1", "Chapter 2", … as bare lines; taken literally each becomes an
   * empty (or near-empty) chapter, and the last entry swallows whatever front
   * matter sits before the real first chapter. Off by default so existing
   * callers are byte-for-byte unchanged; the audiobook importer turns it on.
   */
  dropContentsList?: boolean;
  /** Authoritative format boundaries; offsets refer to normalized plain text. */
  headings?: ManuscriptHeading[];
  /** Fold stacked title-only sections into the next script without losing titles. */
  preserveHeadingStacks?: boolean;
}

export interface ManuscriptHeading {
  title: string;
  source_start: number;
  content_start: number;
  heading_text?: string;
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
  const normalized = options.headings ? sourceNormalized : hideMarkdownHeadingMarkers(sourceNormalized);
  if (normalized.trim().length === 0) {
    return [];
  }

  const sourceLines = sourceNormalized.split("\n");
  const lines = normalized.split("\n");
  let hashHeadingNumber = 0;
  const detectedHeadings = lines.flatMap((line, lineIndex) => {
    const hashTitle = options.hashStartsChapter
      ? hashHeadingTitle(sourceLines[lineIndex], hashHeadingNumber + 1)
      : null;
    if (hashTitle) {
      hashHeadingNumber += 1;
    }
    const title = hashTitle ?? headingTitle(line, lineIndex, lines);
    return title ? [{ lineIndex, title }] : [];
  });
  const textHeadings = options.dropContentsList
    ? dropContentsListHeadings(detectedHeadings, lines)
    : detectedHeadings;
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const headings: ManuscriptHeading[] = options.headings ?? textHeadings.map(heading => ({
    title: heading.title,
    source_start: offsets[heading.lineIndex],
    content_start: Math.min(normalized.length, offsets[heading.lineIndex] + lines[heading.lineIndex].length + 1),
  }));
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
  const preamble = normalized.slice(0, firstHeading.source_start).trim();
  if (preamble.length > 0) {
    const preambleStart = firstNonWhitespaceOffset(normalized);
    const headingStart = firstHeading.source_start;
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
    const bodyStart = heading.content_start;
    const bodyEnd = nextHeading?.source_start ?? normalized.length;
    const rawBody = normalized.slice(bodyStart, bodyEnd);
    const text = rawBody.trim();
    const headingStart = heading.source_start;
    const leadingWhitespace = rawBody.match(/^\s*/u)?.[0].length ?? 0;
    const contentStart = Math.min(bodyEnd, bodyStart + leadingWhitespace);
    const contentEnd = Math.max(contentStart, bodyStart + rawBody.trimEnd().length);

    chapters.push(
      { ...makeChapter({
        id: `${idPrefix}${String(chapters.length + 1).padStart(2, "0")}`,
        index: chapters.length + 1,
        title: heading.title,
        text,
        sourceStart: headingStart,
        sourceEnd: Math.max(headingStart, bodyEnd),
        contentStart,
        contentEnd,
        maxMinutes,
      }), ...(heading.heading_text ? { heading_text: heading.heading_text } : {}) },
    );
  });

  if (options.headings || options.preserveHeadingStacks) {
    // Publishers commonly stack a volume title and a part/chapter title before
    // any prose. Keep every title, but attach the stack to the next real body.
    const merged: ManuscriptChapter[] = [];
    let pending: ManuscriptChapter | undefined;
    for (const chapter of chapters) {
      const current = pending ? {
        ...chapter,
        source_start: pending.source_start,
        heading_text: `${pending.heading_text ?? pending.title}\n${chapter.heading_text ?? chapter.title}`,
      } : chapter;
      if (current.text.length === 0) {
        pending = current;
      } else {
        merged.push(current);
        pending = undefined;
      }
    }
    if (pending) merged.push(pending);
    return merged.map((chapter, index) => ({ ...chapter, index: index + 1, id: `${idPrefix}${String(index + 1).padStart(2, "0")}` }));
  }
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
    ) {
      previous.text += text;
    } else {
      result.push({ ...span, text, style: [...span.style] });
    }
  }
  return result;
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

/** Words of narration between two heading lines, excluding the headings. */
function bodyWordsBetween(lines: string[], firstHeadingLine: number, nextHeadingLine: number): number {
  if (nextHeadingLine <= firstHeadingLine + 1) {
    return 0;
  }
  return countWords(lines.slice(firstHeadingLine + 1, nextHeadingLine).join("\n"));
}

/**
 * Remove headings that belong to a Table of Contents. A contents list is a run
 * of headings stacked together with (almost) no narration between consecutive
 * entries — the shape of "Chapter 1 / Chapter 2 / Chapter 3 …" on a contents
 * page. Short real chapters can have the same shape, so also require a contents
 * label or a repeat of those headings later in the book. Dropping the headings lets
 * their sparse text fold back into the preceding section instead of becoming
 * empty chapters (or one phantom chapter that eats the front matter after it).
 */
function dropContentsListHeadings(headings: Heading[], lines: string[]): Heading[] {
  const ADJACENT_MAX_WORDS = 2;
  const MIN_RUN = 3;
  const drop = new Set<number>();
  let index = 0;
  while (index < headings.length) {
    let end = index;
    while (
      end + 1 < headings.length
      && bodyWordsBetween(lines, headings[end].lineIndex, headings[end + 1].lineIndex) <= ADJACENT_MAX_WORDS
    ) {
      end += 1;
    }
    const nearbyContentsLabel = lines.slice(Math.max(0, headings[index].lineIndex - 6), headings[index].lineIndex)
      .some(line => /^(?:table\s+of\s+)?contents\s*$/iu.test(line.trim()));
    const repeatedLater = headings.slice(index, end + 1).every(heading =>
      headings.slice(end + 1).some(later => later.title.toLowerCase() === heading.title.toLowerCase()),
    );
    if (end - index + 1 >= MIN_RUN && (nearbyContentsLabel || repeatedLater)) {
      for (let position = index; position <= end; position += 1) {
        drop.add(position);
      }
    }
    index = end + 1;
  }
  if (drop.size === 0) {
    return headings;
  }
  return headings.filter((_, position) => !drop.has(position));
}

function headingTitle(line: string, lineIndex: number, lines: string[]): string | null {
  const rawCandidate = line.trim();
  const markdownHeading = /^#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?$/u.exec(rawCandidate);
  const candidate = (markdownHeading?.[1] ?? rawCandidate).trim();
  if (candidate.length === 0 || candidate.length > 140) {
    return null;
  }

  // A chapter label needs a number/name separator; a sentence such as
  // "Chapter books are popular" is ordinary narration.
  const ordinal = "(?:\\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[ -]\\w+)?|thirty(?:[ -]\\w+)?|forty(?:[ -]\\w+)?|fifty(?:[ -]\\w+)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)";
  if (new RegExp(`^(?:chapter|part|book|meditation|canto|act)\\s+${ordinal}(?:$|[\\s.:—–-])`, "iu").test(candidate)
    || /^(?:chapter|part|book)\s*[:—–-]\s*\S/iu.test(candidate)
    || /^(?:prologue|epilogue|preface|introduction|foreword|afterword|appendix)(?:$|\s*[:—–-]\s*\S)/iu.test(candidate)
    || /^(?:opening|closing)\s+credits?\b/iu.test(candidate)) {
    return candidate;
  }

  if (/^[IVXLCDM]+[.)]?$/u.test(candidate) && lines.filter(value => /^[IVXLCDM]+[.)]?$/u.test(value.trim())).length > 1) {
    const previousBlank = lineIndex === 0 || !lines[lineIndex - 1].trim();
    const nextBlank = lineIndex === lines.length - 1 || !lines[lineIndex + 1].trim();
    return previousBlank && nextBlank ? candidate : null;
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
