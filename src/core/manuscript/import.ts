import { strFromU8, unzipSync } from "fflate";
import type { ScriptSpan } from "../project/types";

export type ManuscriptFormat = "txt" | "md" | "docx" | "epub" | "pdf";

export interface ImportedManuscript {
  format: ManuscriptFormat;
  text: string;
  spans: ScriptSpan[];
}

/** Decode a local manuscript file. No format parser performs network access. */
export function importManuscriptBytes(bytes: Uint8Array, extension: string): ImportedManuscript {
  const normalizedExtension = extension.replace(/^\./, "").toLocaleLowerCase("en-US");
  if (normalizedExtension === "txt" || normalizedExtension === "md" || normalizedExtension === "markdown") {
    return fromPlainText(strFromU8(bytes), normalizedExtension === "txt" ? "txt" : "md");
  }
  if (normalizedExtension === "docx") {
    return parseDocx(unzipSync(bytes));
  }
  if (normalizedExtension === "epub") {
    return parseEpub(unzipSync(bytes));
  }
  throw new Error(`Unsupported manuscript format: .${normalizedExtension || "unknown"}`);
}

export function fromPlainText(text: string, format: "txt" | "md" | "pdf" = "txt"): ImportedManuscript {
  const normalized = text.replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n");
  return {
    format,
    text: normalized,
    spans: [{ text: normalized, seat: "narration", style: [] }],
  };
}

function parseDocx(entries: Record<string, Uint8Array>): ImportedManuscript {
  const documentEntry = entries["word/document.xml"];
  if (!documentEntry) {
    throw new Error("DOCX does not contain word/document.xml");
  }
  const xml = strFromU8(documentEntry);
  const paragraphMatches = Array.from(xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/giu));
  const spans: ScriptSpan[] = [];

  paragraphMatches.forEach((paragraphMatch, paragraphIndex) => {
    const paragraphXml = paragraphMatch[1];
    const runMatches = Array.from(paragraphXml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/giu));
    const paragraphSpans: ScriptSpan[] = [];
    for (const runMatch of runMatches) {
      const runXml = runMatch[1];
      const text = extractRunText(runXml);
      if (text.length === 0) {
        continue;
      }
      paragraphSpans.push({ text, seat: "narration", style: extractRunStyle(runXml) });
    }
    if (paragraphSpans.length === 0) {
      const fallback = decodeXmlEntities(stripTags(paragraphXml)).trim();
      if (fallback.length > 0) {
        paragraphSpans.push({ text: fallback, seat: "narration", style: [] });
      }
    }
    if (paragraphIndex > 0) {
      spans.push({ text: "\n", seat: "narration", style: [] });
    }
    spans.push(...paragraphSpans);
  });

  if (spans.length === 0) {
    throw new Error("DOCX contains no readable paragraphs");
  }
  return { format: "docx", text: spans.map((span) => span.text).join(""), spans };
}

function parseEpub(entries: Record<string, Uint8Array>): ImportedManuscript {
  const names = Object.keys(entries)
    .filter((name) => /\.(?:xhtml?|html?)$/iu.test(name) && !/(?:nav|toc)/iu.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  if (names.length === 0) {
    throw new Error("EPUB contains no readable XHTML chapters");
  }
  const pieces = names.map((name) => htmlToText(strFromU8(entries[name]))).filter((piece) => piece.length > 0);
  const text = pieces.join("\n");
  if (text.trim().length === 0) {
    throw new Error("EPUB contains no readable text; scanned pages are not supported");
  }
  return {
    format: "epub",
    text,
    spans: [{ text, seat: "narration", style: [] }],
  };
}

function extractRunText(runXml: string): string {
  const pieces: string[] = [];
  for (const textMatch of runXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/giu)) {
    pieces.push(decodeXmlEntities(textMatch[1]));
  }
  for (const _ of runXml.matchAll(/<w:tab\s*\/?>(?:<\/w:tab>)?/giu)) {
    pieces.push("\t");
  }
  for (const _ of runXml.matchAll(/<w:br\s*\/?>(?:<\/w:br>)?/giu)) {
    pieces.push("\n");
  }
  return pieces.join("");
}

function extractRunStyle(runXml: string): ScriptSpan["style"] {
  const properties = runXml.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/iu)?.[1] ?? "";
  const style: ScriptSpan["style"] = [];
  if (hasOnTag(properties, "b")) {
    style.push("bold");
  }
  if (hasOnTag(properties, "i")) {
    style.push("italic");
  }
  if (/<w:u\b(?![^>]*w:val\s*=\s*["']none["'])[^>]*\/?>(?:<\/w:u>)?/iu.test(properties)) {
    style.push("underline");
  }
  if (/<w:highlight\b[^>]*\/?>/iu.test(properties)) {
    style.push("highlight");
  }
  return style;
}

function hasOnTag(xml: string, tag: string): boolean {
  const match = xml.match(new RegExp(`<w:${tag}\\b([^>]*)\\/?>(?:<\\/w:${tag}>)?`, "iu"));
  if (!match) {
    return false;
  }
  return !/w:val\s*=\s*["'](?:0|false|off|none)["']/iu.test(match[1]);
}

function htmlToText(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? html;
  const withoutNoise = body
    .replace(/<script\b[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[\s\S]*?<\/style>/giu, "")
    .replace(/<br\s*\/?>(?:\s*)/giu, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article)>/giu, "\n")
    .replace(/<[^>]+>/gu, "");
  return decodeXmlEntities(withoutNoise)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, "");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&#(\d+);/gu, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/giu, (_match, hexadecimal: string) => String.fromCodePoint(Number.parseInt(hexadecimal, 16)));
}
