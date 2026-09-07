import type { ScriptSpan } from "../project/types";
import { hideMarkdownHeadingMarkers, splitManuscript, type ManuscriptHeading, type SplitManuscriptOptions } from "./split";
import { readArchiveEntries } from "./archive";
import { extractEpub } from "./epub";
import { extractDocx } from "./docx";
import { decodeManuscriptText } from "./encoding";

export type ManuscriptFormat = "txt" | "md" | "docx" | "epub" | "pdf";

export interface ImportedManuscript {
  format: ManuscriptFormat;
  text: string;
  spans: ScriptSpan[];
  /** Original normalized plain text, retained for format-specific chapter splitting. */
  source_text?: string;
  /** Publisher-defined chapter boundaries in text/spans, before heuristic splitting. */
  headings?: ManuscriptHeading[];
}

/** Decode a local manuscript file. No format parser performs network access. */
export function importManuscriptBytes(bytes: Uint8Array, extension: string): ImportedManuscript {
  const normalizedExtension = extension.replace(/^\./, "").toLocaleLowerCase("en-US");
  if (normalizedExtension === "txt" || normalizedExtension === "md" || normalizedExtension === "markdown") {
    return fromPlainText(decodeManuscriptText(bytes), normalizedExtension === "txt" ? "txt" : "md");
  }
  if (normalizedExtension === "docx") {
    const parsed = extractDocx(readArchiveEntries(bytes, name => /^word\/(?:document|styles)\.xml$/iu.test(name), { maxBytes: 100 * 1024 * 1024, maxFiles: 2 }));
    return { format: "docx", ...parsed, spans: inferDialogueSpans(parsed.spans) };
  }
  if (normalizedExtension === "epub") {
    const parsed = extractEpub(bytes);
    return { format: "epub", ...parsed, spans: inferDialogueSpans([{ text: parsed.text, seat: "narration", style: [] }]) };
  }
  throw new Error(`Unsupported manuscript format: .${normalizedExtension || "unknown"}`);
}

/** Use format structure when available, preserving heading-only parent titles. */
export function splitImportedManuscript(imported: ImportedManuscript, options: SplitManuscriptOptions = {}) {
  return splitManuscript(imported.source_text ?? imported.text, {
    hashStartsChapter: true,
    dropContentsList: true,
    preserveHeadingStacks: true,
    ...options,
    headings: imported.headings,
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
