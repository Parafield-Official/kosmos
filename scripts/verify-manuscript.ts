/** Exercise real files through upload and saved-book analysis without saving a project.
 * Usage: npx jiti scripts/verify-manuscript.ts /path/to/book.epub
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { importManuscriptBytes, splitImportedManuscript } from "../src/core/manuscript/import";
import { analyzeFile, analyzeManuscript } from "../labs/next/src/main-app/analyze";
import { compactText, parseMarkup } from "../src/core/manuscript/xml";

const filename = process.argv[2];
if (!filename) throw new Error("Pass a manuscript path: npx jiti scripts/verify-manuscript.ts /path/to/book.epub");
const bytes = readFileSync(filename);
const name = path.basename(filename);
const imported = importManuscriptBytes(bytes, path.extname(filename));
const sections = splitImportedManuscript(imported);
const normalized = (text: string) => text.replace(/\s+/gu, " ").trim();
const reconstructed = sections.map(section =>
  imported.text.slice(section.source_start, section.content_start) + section.text,
).join("\n");
assert.ok(normalized(reconstructed) === normalized(imported.text), "Chapter ranges must preserve all source text, in order");
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  setTimeout: (callback: () => void) => { callback(); return 0; },
} });
const fresh = await analyzeFile(new File([bytes], name));
const saved = await analyzeManuscript(name, bytes);
assert.deepEqual(fresh.chapters.map(chapter => [chapter.title, chapter.wordCount]), saved.chapters.map(chapter => [chapter.title, chapter.wordCount]));
assert.deepEqual(fresh.contents.map(chapter => chapter.html), saved.contents.map(chapter => chapter.html));
const rendered = fresh.contents.map(chapter => compactText(parseMarkup(`<html><body>${chapter.html}</body></html>`, true).documentElement)).join(" ");
// Structural documents with visible headings should survive the complete HTML
// path exactly. Navigation-only titles may legitimately add spoken labels.
const allHeadingsVisible = imported.headings?.every(heading => heading.content_start > heading.source_start);
if (allHeadingsVisible) assert.ok(normalized(rendered) === normalized(imported.text), "Teleprompter must preserve every word and heading exactly once");
console.log(JSON.stringify({
  file: name,
  chapters: fresh.chapters.length,
  sourceWords: imported.text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0,
  sameUploadAndReanalysis: true,
  exactSourcePreservation: true,
  exactTeleprompterPreservation: allHeadingsVisible ?? false,
  titles: fresh.chapters.map(chapter => chapter.title),
}, null, 2));
