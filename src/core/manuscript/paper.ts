/**
 * Turn manuscript / transcript plain text into page-shaped blocks.
 *
 * The Review card used to dump the chapter into one <p> and the ASR
 * transcript into a textarea. Both read as a wall. These helpers keep the
 * bytes honest (no rewriting) while giving the UI paragraphs and headings.
 */

export type PaperInline =
  | { kind: "text"; text: string }
  | { kind: "em"; text: string }
  | { kind: "strong"; text: string };

export type PaperBlock =
  | { kind: "heading"; text: string; level: 1 | 2; inlines: PaperInline[] }
  | { kind: "paragraph"; text: string; inlines: PaperInline[] };

const HEADING_WORD = /^(chapter\s+\d+|part\s+\d+|book\s+\d+|prologue|epilogue|afterword|foreword|introduction)\b/iu;

/** Light markdown for imported .md books. No nested marks, no links. */
export function inlineMarkdown(source: string): PaperInline[] {
  const tokens: PaperInline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) {
      tokens.push({ kind: "text", text: source.slice(cursor, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ kind: "strong", text: match[1] });
    } else {
      tokens.push({ kind: "em", text: match[2] ?? match[3] ?? "" });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) {
    tokens.push({ kind: "text", text: source.slice(cursor) });
  }
  return tokens.length > 0 ? tokens : [{ kind: "text", text: source }];
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 72) {
    return false;
  }
  if (/^#{1,6}\s+\S/u.test(trimmed)) {
    return true;
  }
  if (HEADING_WORD.test(trimmed)) {
    return true;
  }
  // hideMarkdownHeadingMarkers replaces leading hashes with spaces, so
  // "## Scene" becomes "   Scene". A leftover indent + short title is a heading.
  if (/^[\t ]{2,}\S/u.test(line) && !/[.!?…]$/u.test(trimmed) && trimmed.split(/\s+/u).length <= 10) {
    return true;
  }
  return false;
}

function headingLevel(line: string): 1 | 2 {
  const hashes = /^#{1,6}/u.exec(line.trim());
  if (hashes && hashes[0].length >= 3) {
    return 2;
  }
  const trimmed = line.trim();
  if (HEADING_WORD.test(trimmed) || /^#{1,2}\s/u.test(trimmed)) {
    return 1;
  }
  return 2;
}

function cleanHeading(line: string): string {
  return line.replace(/^[\t ]{0,3}#{1,6}[\t ]+/u, "").replace(/[\t ]+#{1,6}[\t ]*$/u, "").trim();
}

function collapseInteriorNewlines(text: string): string {
  return text.replace(/[ \t]*\n[ \t]*/gu, " ").replace(/ {2,}/gu, " ").trim();
}

/**
 * Manuscript: blank lines start paragraphs. A short heading line sits on
 * its own. Interior hard wraps become spaces so the page can reflow.
 */
export function manuscriptBlocks(source: string): PaperBlock[] {
  const normalized = source.replace(/\r\n?/gu, "\n").replace(/^\uFEFF/u, "");
  const chunks = normalized.split(/\n\s*\n/u);
  const blocks: PaperBlock[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    if (lines.every((line) => line.trim().length === 0)) {
      continue;
    }
    const first = lines[0] ?? "";
    if (looksLikeHeading(first)) {
      const headingText = cleanHeading(first);
      if (headingText.length > 0) {
        blocks.push({
          kind: "heading",
          text: headingText,
          level: headingLevel(first),
          inlines: inlineMarkdown(headingText),
        });
      }
      const rest = collapseInteriorNewlines(lines.slice(1).join("\n"));
      if (rest.length > 0) {
        blocks.push({ kind: "paragraph", text: rest, inlines: inlineMarkdown(rest) });
      }
      continue;
    }
    const paragraph = collapseInteriorNewlines(chunk);
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph, inlines: inlineMarkdown(paragraph) });
    }
  }
  return blocks;
}

const TRANSCRIPT_PARAGRAPH_WORDS = 90;

/**
 * Transcript: keep author-typed paragraphs. A Whisper wall (no newlines)
 * is broken every ~90 words so the eye can rest. Words are not rewritten.
 */
export function transcriptBlocks(source: string): PaperBlock[] {
  const normalized = source.replace(/\r\n?/gu, "\n").replace(/^\uFEFF/u, "").trim();
  if (normalized.length === 0) {
    return [];
  }
  if (/\n\s*\n/u.test(normalized) || looksLikeHeading(normalized.split("\n")[0] ?? "")) {
    return manuscriptBlocks(normalized);
  }
  if (!normalized.includes("\n")) {
    return splitWordWall(normalized);
  }
  const paragraph = collapseInteriorNewlines(normalized);
  return paragraph.length > 0
    ? splitWordWall(paragraph)
    : [];
}

function splitWordWall(source: string): PaperBlock[] {
  const words = source.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length <= TRANSCRIPT_PARAGRAPH_WORDS) {
    return [{ kind: "paragraph", text: source, inlines: inlineMarkdown(source) }];
  }
  const blocks: PaperBlock[] = [];
  for (let index = 0; index < words.length; index += TRANSCRIPT_PARAGRAPH_WORDS) {
    const text = words.slice(index, index + TRANSCRIPT_PARAGRAPH_WORDS).join(" ");
    blocks.push({ kind: "paragraph", text, inlines: inlineMarkdown(text) });
  }
  return blocks;
}
