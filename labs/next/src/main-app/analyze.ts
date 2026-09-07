import { fromPlainText, importManuscriptBytes, splitImportedManuscript, type ImportedManuscript } from "../../../../src/core/manuscript/import";
import { sliceScriptSpans, type ManuscriptChapter } from "../../../../src/core/manuscript/split";
import type { ScriptSpan } from "../../../../src/core/project/types";
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
export function chapterHtmlFromText(text: string, markdown = true): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  const blocks = /\n{2,}/.test(normalized) ? normalized.split(/\n{2,}/) : normalized.split(/\n/);
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${(markdown ? inlineMarkup : escapeHtml)(block.replace(/\n/g, " "))}</p>`)
    .join("\n");
}

/**
 * Build a chapter's teleprompter HTML with its heading as the first line.
 * Audiobook narrators announce each chapter break aloud ("Chapter One",
 * "Prologue"), so the heading belongs in the script, not just in the sidebar.
 * The synthetic "Front matter" label is not a spoken heading, so it is skipped;
 * its body (title, author, copyright) is still shown.
 */
export function chapterHtmlWithHeading(title: string, text: string, markdown = true): string {
  const heading = title.trim();
  const body = chapterHtmlFromText(text, markdown);
  if (!heading || heading.toLowerCase() === "front matter") {
    return body;
  }
  const headingHtml = `<h2>${(markdown ? inlineMarkup : escapeHtml)(heading)}</h2>`;
  return body ? `${headingHtml}\n${body}` : headingHtml;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function extension(name: string): string {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/** Split source text into chapters (+ per-chapter HTML), reporting progress. */
export async function analyzeSource(source: string, onProgress?: AnalyzeProgress): Promise<AnalyzeResult> {
  return analyzeImported(fromPlainText(source), onProgress);
}

/** Same structured-byte path for a new upload and a saved book's re-analysis. */
export async function analyzeManuscript(name: string, bytes: Uint8Array, onProgress?: AnalyzeProgress): Promise<AnalyzeResult> {
  const imported = importManuscriptBytes(bytes, extension(name));
  return analyzeImported(imported, onProgress);
}

function analyzeImported(imported: ImportedManuscript, onProgress?: AnalyzeProgress): Promise<AnalyzeResult> {
  const chapters = splitImportedManuscript(imported);
  if (!chapters.length) throw new Error("Kosmos couldn't read any text from that manuscript.");
  return analyzeSections(chapters, onProgress, imported.format === "txt" || imported.format === "md" || imported.format === "pdf",
    imported.format === "docx" ? imported.spans : undefined);
}

function chapterHtmlFromSpans(spans: ScriptSpan[]): string {
  const markup = spans.map(span => span.text.split("\n").map(part => {
    let html = escapeHtml(part);
    if (!html) return html;
    for (const style of span.style) {
      const tag = { italic: "em", bold: "strong", underline: "u", highlight: "mark" }[style];
      if (tag) html = `<${tag}>${html}</${tag}>`;
    }
    return html;
  }).join("\n")).join("");
  return markup.split("\n").filter(line => line.trim()).map(line => `<p>${line}</p>`).join("\n");
}

async function analyzeSections(sections: ManuscriptChapter[], onProgress?: AnalyzeProgress, markdown = true, spans?: ScriptSpan[]): Promise<AnalyzeResult> {
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
      hasMasteredAudio: false,
      resumeWordIndex: 0,
      proofed: false,
      mastered: false,
    });
    const title = section.heading_text ?? section.title;
    const html = spans
      ? [chapterHtmlWithHeading(title, "", false), chapterHtmlFromSpans(sliceScriptSpans(spans, section.content_start, section.content_end))].filter(Boolean).join("\n")
      : chapterHtmlWithHeading(title, section.text, markdown);
    contents.push({ id, html });
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
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    return analyzeManuscript(file.name, new Uint8Array(await file.arrayBuffer()), onProgress);
  } else if (ext === "docx" || ext === "epub") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return analyzeManuscript(file.name, bytes, onProgress);
  } else if (ext === "pdf") {
    // PDFs are containers, not UTF-8 manuscripts. The Electron main process
    // extracts them with bundled MarkItDown/pdftotext before analysis.
    throw new Error("PDF manuscripts must be extracted by the desktop app before analysis.");
  } else {
    throw new Error("Unsupported manuscript format. Try .txt, .md, .docx, .epub, or .pdf.");
  }
}
