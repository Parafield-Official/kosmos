import { strFromU8, unzipSync } from "fflate";
import type { ScriptSpan } from "../project/types";
import { hideMarkdownHeadingMarkers } from "./split";

export type ManuscriptFormat = "txt" | "md" | "docx" | "epub" | "pdf";

export interface ImportedManuscript {
  format: ManuscriptFormat;
  text: string;
  spans: ScriptSpan[];
  /** Original normalized plain text, retained for format-specific chapter splitting. */
  source_text?: string;
}

const MAX_DOCX_TEXT_BYTES = 100 * 1024 * 1024;
const MAX_EPUB_TEXT_BYTES = 200 * 1024 * 1024;
const MAX_EPUB_TEXT_FILES = 1_000;

/** Decode a local manuscript file. No format parser performs network access. */
export function importManuscriptBytes(bytes: Uint8Array, extension: string): ImportedManuscript {
  const normalizedExtension = extension.replace(/^\./, "").toLocaleLowerCase("en-US");
  if (normalizedExtension === "txt" || normalizedExtension === "md" || normalizedExtension === "markdown") {
    return fromPlainText(strFromU8(bytes), normalizedExtension === "txt" ? "txt" : "md");
  }
  if (normalizedExtension === "docx") {
    return parseDocx(unzipManuscript(bytes, "docx"));
  }
  if (normalizedExtension === "epub") {
    return parseEpub(unzipManuscript(bytes, "epub"));
  }
  throw new Error(`Unsupported manuscript format: .${normalizedExtension || "unknown"}`);
}

/**
 * Expand only manuscript text entries and enforce decompressed budgets. ZIP
 * archives can be tiny while declaring gigabytes of XML (a classic ZIP-bomb
 * shape); passing an unrestricted archive to unzipSync would let a malformed
 * import exhaust the renderer process.
 */
function unzipManuscript(
  bytes: Uint8Array,
  format: "docx" | "epub",
): Record<string, Uint8Array> {
  let totalBytes = 0;
  let fileCount = 0;
  const maxBytes = format === "docx" ? MAX_DOCX_TEXT_BYTES : MAX_EPUB_TEXT_BYTES;
  const maxFiles = format === "docx" ? 1 : MAX_EPUB_TEXT_FILES;
  return unzipSync(bytes, {
    filter: (file) => {
      const normalizedName = file.name.replaceAll("\\", "/");
      const relevant = format === "docx"
        ? /^word\/document\.xml$/iu.test(normalizedName)
        : /(?:^meta-inf\/container\.xml$|\.opf$|\.(?:xhtml?|html?))$/iu.test(normalizedName);
      if (!relevant) {
        return false;
      }
      const originalSize = Number(file.originalSize);
      if (!Number.isSafeInteger(originalSize) || originalSize < 0) {
        throw new Error("Manuscript archive has an invalid uncompressed entry size");
      }
      fileCount += 1;
      totalBytes += originalSize;
      if (fileCount > maxFiles || originalSize > maxBytes || totalBytes > maxBytes) {
        throw new Error("Manuscript archive is too large or contains too many text entries");
      }
      return true;
    },
  });
}

export function fromPlainText(text: string, format: "txt" | "md" | "pdf" = "txt"): ImportedManuscript {
  const sourceText = text.replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n");
  const normalized = hideMarkdownHeadingMarkers(sourceText);
  const baseSpan: ScriptSpan = { text: normalized, seat: "narration", style: [] };
  return {
    format,
    text: normalized,
    source_text: sourceText,
    spans: inferDialogueSpans([baseSpan]),
  };
}

/** Split quoted dialogue into marked spans without guessing a narrator seat. */
export function inferDialogueSpans(spans: ScriptSpan[]): ScriptSpan[] {
  const output: ScriptSpan[] = [];
  let inDialogue = false;
  for (const span of spans) {
    let cursor = 0;
    let emittedInSpan = false;
    const emit = (text: string, dialogue: boolean): void => {
      if (text.length === 0) {
        return;
      }
      appendDialoguePiece(output, span, text, dialogue, emittedInSpan);
      emittedInSpan = true;
    };
    for (let index = 0; index < span.text.length; index += 1) {
      const character = span.text[index];
      if (!isQuoteMark(span.text, index)) {
        continue;
      }
      emit(span.text.slice(cursor, index), inDialogue);
      const closes: boolean = character === "”" || character === "’" || inDialogue;
      if (closes) {
        emit(character, inDialogue);
        inDialogue = false;
      } else {
        inDialogue = true;
        emit(character, true);
      }
      cursor = index + 1;
    }
    emit(span.text.slice(cursor), inDialogue);
  }
  return output;
}

function isQuoteMark(text: string, index: number): boolean {
  const character = text[index];
  if (character === '"' || character === "“" || character === "”" || character === "‘") {
    return true;
  }
  if (character !== "’") {
    return false;
  }
  const previous = text[index - 1] ?? "";
  const next = text[index + 1] ?? "";
  return !(isWordCharacter(previous) && isWordCharacter(next));
}

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

function appendDialoguePiece(
  output: ScriptSpan[],
  span: ScriptSpan,
  text: string,
  dialogue: boolean,
  mergeWithPrevious: boolean,
): void {
  if (text.length === 0) {
    return;
  }
  const previous = output.at(-1);
  if (
    mergeWithPrevious
    && previous
    && previous.seat === span.seat
    && (previous.dialogue ?? false) === dialogue
    && JSON.stringify(previous.style) === JSON.stringify(span.style)
    && previous.glossary_id === span.glossary_id
    && JSON.stringify(previous.performance_cue) === JSON.stringify(span.performance_cue)
  ) {
    previous.text += text;
    return;
  }
  const { dialogue: _existingDialogue, ...baseSpan } = span;
  output.push({
    ...baseSpan,
    text,
    style: [...span.style],
    ...(dialogue ? { dialogue: true } : {}),
  });
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
  return { format: "docx", text: spans.map((span) => span.text).join(""), spans: inferDialogueSpans(spans) };
}

function parseEpub(entries: Record<string, Uint8Array>): ImportedManuscript {
  const names = epubReadingOrder(entries);
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
    spans: inferDialogueSpans([{ text, seat: "narration", style: [] }]),
  };
}

/**
 * EPUBs are ordered by the OPF spine, not by their filenames. A surprising
 * number of books use names such as `part-10.xhtml` and `part-2.xhtml`, so a
 * lexical sort silently rearranges the manuscript. Keep the parser local and
 * deliberately small: use the container/OPF metadata when present, then fall
 * back to a deterministic natural filename order for malformed exports.
 */
function epubReadingOrder(entries: Record<string, Uint8Array>): string[] {
  const allXhtml = Object.keys(entries)
    .filter((name) => /\.(?:xhtml?|html?)$/iu.test(name) && !/(?:^|[/\\])(?:nav|toc)(?:[/\\]|\.|$)/iu.test(name));
  if (allXhtml.length === 0) {
    return [];
  }

  const containerName = Object.keys(entries).find((name) =>
    name.toLocaleLowerCase("en-US") === "meta-inf/container.xml",
  );
  const containerXml = containerName ? strFromU8(entries[containerName]) : "";
  const rootFilePath = readXmlAttribute(
    containerXml.match(/<rootfile\b[^>]*>/iu)?.[0] ?? "",
    "full-path",
  );
  const opfPath = rootFilePath ? normalizeEpubPath(rootFilePath) : findOpfPath(entries);
  const opf = opfPath ? strFromU8(entries[opfPath] ?? new Uint8Array()) : "";
  if (opf.length > 0) {
    const manifest = new Map<string, string>();
    for (const item of opf.matchAll(/<item\b([^>]*)\/?>(?:<\/item>)?/giu)) {
      const attributes = item[1] ?? "";
      const id = readXmlAttribute(attributes, "id");
      const href = readXmlAttribute(attributes, "href");
      const mediaType = readXmlAttribute(attributes, "media-type");
      const properties = readXmlAttribute(attributes, "properties");
      if (!id || !href || properties?.split(/\s+/u).includes("nav")) {
        continue;
      }
      if (mediaType && !/application\/(?:xhtml\+xml|xml|html)/iu.test(mediaType)) {
        continue;
      }
      const resolved = normalizeEpubPath(resolveEpubRelativePath(opfPath ?? "", href));
      if (resolved && allXhtml.includes(resolved)) {
        manifest.set(id, resolved);
      }
    }

    const ordered = [] as string[];
    for (const itemRef of opf.matchAll(/<itemref\b([^>]*)\/?>(?:<\/itemref>)?/giu)) {
      const idref = readXmlAttribute(itemRef[1] ?? "", "idref");
      const name = idref ? manifest.get(idref) : undefined;
      if (name && !ordered.includes(name)) {
        ordered.push(name);
      }
    }
    if (ordered.length > 0) {
      return ordered;
    }
  }

  return allXhtml.sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function findOpfPath(entries: Record<string, Uint8Array>): string | undefined {
  return Object.keys(entries)
    .filter((name) => /\.opf$/iu.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))[0];
}

function readXmlAttribute(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = source.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "iu"));
  return match ? decodeXmlEntities(match[2]) : undefined;
}

function resolveEpubRelativePath(basePath: string, relativePath: string): string {
  const baseDirectory = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
  return `${baseDirectory}/${relativePath.split("#", 1)[0]}`;
}

function normalizeEpubPath(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.replaceAll("\\", "/"));
  } catch {
    // Preserve a malformed local filename for the deterministic fallback;
    // never let one bad percent escape crash an otherwise readable EPUB.
    decoded = value.replaceAll("\\", "/");
  }
  const parts: string[] = [];
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function extractRunText(runXml: string): string {
  const pieces: string[] = [];
  const tokenPattern = /<w:(t|tab|br)\b([^>]*)>([\s\S]*?)<\/w:\1>|<w:(tab|br)\b[^>]*\/?\s*>/giu;
  for (const match of runXml.matchAll(tokenPattern)) {
    const kind = (match[1] ?? match[4] ?? "").toLocaleLowerCase("en-US");
    if (kind === "t") {
      pieces.push(decodeXmlEntities(match[3] ?? ""));
    } else if (kind === "tab") {
      pieces.push("\t");
    } else {
      pieces.push("\n");
    }
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
    .replace(/&([a-z][a-z\d]+);/giu, (match, name: string) => decodeNamedEntity(match, name))
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&#(\d+);/gu, (match, decimal: string) => safeCodePoint(match, Number(decimal)))
    .replace(/&#x([\da-f]+);/giu, (match, hexadecimal: string) => safeCodePoint(match, Number.parseInt(hexadecimal, 16)));
}

const COMMON_HTML_ENTITIES: Record<string, string> = {
  nbsp: "\u00a0",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  laquo: "\u00ab",
  raquo: "\u00bb",
  bull: "\u2022",
  middot: "\u00b7",
  thinsp: "\u2009",
  ensp: "\u2002",
  emsp: "\u2003",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
};

function decodeNamedEntity(original: string, name: string): string {
  return COMMON_HTML_ENTITIES[name.toLocaleLowerCase("en-US")] ?? original;
}

function safeCodePoint(original: string, value: number): string {
  // XML numeric references cannot represent surrogate code points or values
  // outside Unicode's range. Preserve malformed source text for a human to
  // correct instead of crashing an otherwise readable manuscript import.
  if (!Number.isInteger(value) || value < 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) {
    return original;
  }
  return String.fromCodePoint(value);
}
