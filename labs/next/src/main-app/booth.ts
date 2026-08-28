import { decodeWavPcm16, encodeWavPcm16 } from "../../../../src/core/audio/wav";
import { resamplePcmToMono } from "../../../../src/core/audio/resample";
import type { GlossaryEntry, ScriptSpan } from "../../../../src/core/project/types";
import {
  boothScriptFromParagraphs,
  boothScriptFromSpans,
  decorateScriptSpans,
  type BoothMarkedParagraph,
} from "../../../../src/core/teleprompter/script-marks";
import {
  promptHighlightRange,
  promptWordRows,
  type PromptHighlightMode,
  type PromptWordRange,
} from "../../../../src/core/teleprompter/model";
import type { RecordedWord } from "./store";

export type { PromptHighlightMode };
export type BoothParagraph = BoothMarkedParagraph;

const BLOCK_SELECTOR = "p, h1, h2, h3, li, blockquote";

export function paragraphsFromHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const nodes = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR));
  const paras = nodes.map((node) => node.textContent?.trim() ?? "").filter(Boolean);
  if (paras.length) {
    return paras;
  }
  const text = doc.body.textContent?.trim();
  return text ? [text] : [];
}

function styleFromAncestors(node: Node): ScriptSpan["style"] {
  const styles: ScriptSpan["style"] = [];
  let current = node.parentElement;
  while (current && current !== current.ownerDocument?.body) {
    const tag = current.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") {
      styles.push("bold");
    }
    if (tag === "em" || tag === "i") {
      styles.push("italic");
    }
    if (tag === "u") {
      styles.push("underline");
    }
    if (tag === "mark") {
      styles.push("highlight");
    }
    current = current.parentElement;
  }
  return [...new Set(styles)];
}

function spansFromBlock(element: Element): ScriptSpan[] {
  const spans: ScriptSpan[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    if (text.length > 0) {
      spans.push({ text, seat: "narration", style: styleFromAncestors(node) });
    }
    node = walker.nextNode();
  }
  return spans;
}

export function spansFromHtml(html: string): ScriptSpan[] {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const nodes = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR));
  const blocks = nodes.length > 0 ? nodes : doc.body.textContent?.trim() ? [doc.body] : [];
  const spans: ScriptSpan[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const piece = spansFromBlock(blocks[index]);
    if (piece.length === 0) {
      continue;
    }
    if (spans.length > 0) {
      spans.push({ text: "\n", seat: "narration", style: [] });
    }
    spans.push(...piece);
  }
  return spans;
}

export function buildBoothScript(paragraphs: string[], glossary: GlossaryEntry[] = []) {
  return boothScriptFromParagraphs(paragraphs, glossary);
}

export function buildBoothScriptFromHtml(html: string, glossary: GlossaryEntry[] = []) {
  return boothScriptFromSpans(decorateScriptSpans(spansFromHtml(html), glossary));
}

export function coverageOf(resumeWordIndex: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, resumeWordIndex / total));
}

export function highlightBand(
  mode: PromptHighlightMode,
  wordIndex: number,
  paragraph: BoothParagraph | undefined,
  rows: PromptWordRange[],
): PromptWordRange | null {
  if (!paragraph) {
    return null;
  }
  return promptHighlightRange({
    mode,
    wordIndex,
    paragraphFirstWord: paragraph.firstWord,
    paragraphWordCount: paragraph.wordCount,
    rows,
  });
}

export function measureRows(paragraph: BoothParagraph, tops: Array<number | null>): PromptWordRange[] {
  return promptWordRows(paragraph.firstWord, tops);
}

export function mergeRecordedWords(
  prior: RecordedWord[] | undefined,
  added: RecordedWord[],
  fromIndex: number,
): RecordedWord[] {
  const kept = (prior ?? []).filter((word) => word.index < fromIndex);
  const next = [...kept, ...added].sort((a, b) => a.index - b.index);
  const seen = new Set<number>();
  return next.filter((word) => {
    if (seen.has(word.index)) {
      return false;
    }
    seen.add(word.index);
    return true;
  });
}

export function resumeSecondsOf(words: RecordedWord[] | undefined, resumeWordIndex: number): number {
  if (!words?.length || resumeWordIndex <= 0) {
    return 0;
  }
  const last = [...words].reverse().find((word) => word.index < resumeWordIndex);
  return last ? last.end : 0;
}

export function concatWav(existing: Uint8Array | null, extra: Float32Array, sampleRate: number, truncateSeconds: number): Blob {
  let head = extra;
  if (existing && existing.byteLength > 44) {
    try {
      const decoded = decodeWavPcm16(existing);
      const mono = decoded.channels === 1
        ? decoded.samples
        : resamplePcmToMono(decoded.samples, decoded.sampleRate, decoded.sampleRate);
      const keep = Math.max(0, Math.floor(Math.min(truncateSeconds, mono.length / decoded.sampleRate) * decoded.sampleRate));
      const prefix = decoded.sampleRate === sampleRate
        ? mono.subarray(0, keep)
        : resamplePcmToMono(mono.subarray(0, keep), decoded.sampleRate, sampleRate);
      const merged = new Float32Array(prefix.length + extra.length);
      merged.set(prefix, 0);
      merged.set(extra, prefix.length);
      head = merged;
    } catch {
      head = extra;
    }
  }
  if (head.length === 0) {
    return new Blob([], { type: "audio/wav" });
  }
  const bytes = encodeWavPcm16(head, sampleRate, 1);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([copy], { type: "audio/wav" });
}

export function encodePcmWav(samples: Float32Array, sampleRate: number): Blob {
  if (samples.length === 0) {
    return new Blob([], { type: "audio/wav" });
  }
  const bytes = encodeWavPcm16(samples, sampleRate, 1);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([copy], { type: "audio/wav" });
}

export function float32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
