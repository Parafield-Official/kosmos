import { importManuscriptBytes } from "../../../../src/core/manuscript/import";
import { splitManuscript } from "../../../../src/core/manuscript/split";
import type { BookChapter } from "./store";

export type AnalyzeProgress = (fraction: number, label: string) => void;

export interface AnalyzeResult {
  chapters: BookChapter[];
  contents: { id: string; html: string }[];
}

function chapterId(): string {
  return `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimal inline Markdown → HTML for bold/italic, keeping other text intact. */
function inlineMarkup(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>");
}

/** Convert a chapter body to HTML, preserving paragraph structure and emphasis. */
export function chapterHtmlFromText(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  const blocks = /\n{2,}/.test(normalized) ? normalized.split(/\n{2,}/) : normalized.split(/\n/);
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${inlineMarkup(block.replace(/\n/g, " "))}</p>`)
    .join("\n");
}

/**
 * Build a chapter's teleprompter HTML with its heading as the first line.
 * Audiobook narrators announce each chapter break aloud ("Chapter One",
 * "Prologue"), so the heading belongs in the script, not just in the sidebar.
 * The synthetic "Front matter" label is not a spoken heading, so it is skipped;
 * its body (title, author, copyright) is still shown.
 */
export function chapterHtmlWithHeading(title: string, text: string): string {
  const heading = title.trim();
  const body = chapterHtmlFromText(text);
  if (!heading || heading.toLowerCase() === "front matter") {
    return body;
  }
  const headingHtml = `<h2>${inlineMarkup(heading)}</h2>`;
  return body ? `${headingHtml}\n${body}` : headingHtml;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function extension(name: string): string {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/** Turn manuscript bytes into plain source text, reusing the original parsers. */
export function manuscriptSource(name: string, bytes: Uint8Array): string | null {
  const ext = extension(name);
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    return new TextDecoder().decode(bytes);
  }
  if (ext === "docx" || ext === "epub") {
    try {
      const imported = importManuscriptBytes(bytes, ext);
      return imported.source_text ?? imported.text;
    } catch {
      return null;
    }
  }
  // PDF needs a native text extractor; not available in the renderer yet.
  return null;
}

/** Split source text into chapters (+ per-chapter HTML), reporting progress. */
export async function analyzeSource(source: string, onProgress?: AnalyzeProgress): Promise<AnalyzeResult> {
  const split = splitManuscript(source, {
    hashStartsChapter: true,
    defaultTitle: "Chapter 1",
    dropContentsList: true,
  });
  // A chapter you can narrate must contain narration. Heading-shaped lines with
  // no body under them — a Table of Contents, part dividers, a cluster of
  // headings — otherwise become empty chapters whose teleprompter reads "No
  // text yet." Keep only sections that carry words, so every chapter card the
  // booth offers has a script behind it.
  const withText = split.filter((section) => section.word_count > 0);
  const sections = withText.length > 0 ? withText : split;
  if (sections.length === 0) {
    return { chapters: [], contents: [] };
  }
  const chapters: BookChapter[] = [];
  const contents: { id: string; html: string }[] = [];
  const total = sections.length;
  for (let index = 0; index < total; index += 1) {
    const section = sections[index];
    const id = chapterId();
    chapters.push({
      id,
      title: section.title,
      wordCount: section.word_count,
      recordedPct: 0,
      hasOriginalAudio: false,
      hasWorkingAudio: false,
      resumeWordIndex: 0,
      proofed: false,
      mastered: false,
    });
    contents.push({ id, html: chapterHtmlWithHeading(section.title, section.text) });
    onProgress?.((index + 1) / total, section.title);
    // Let the progress bar paint; keep the whole animation short.
    if (total <= 80) {
      await delay(Math.min(50, Math.floor(700 / total)));
    }
  }
  return { chapters, contents };
}

export async function analyzeFile(file: File, onProgress?: AnalyzeProgress): Promise<AnalyzeResult> {
  const ext = extension(file.name);
  let source: string | null = null;
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    source = await file.text();
  } else if (ext === "docx" || ext === "epub") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    source = manuscriptSource(file.name, bytes);
  } else {
    try {
      source = await file.text();
    } catch {
      source = null;
    }
  }
  if (!source || !source.trim()) {
    return { chapters: [], contents: [] };
  }
  return analyzeSource(source, onProgress);
}
