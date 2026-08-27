import { decodeWavPcm16, encodeWavPcm16 } from "../../../../src/core/audio/wav";
import { resamplePcmToMono } from "../../../../src/core/audio/resample";
import {
  promptHighlightRange,
  promptSentenceEnds,
  promptTextTokens,
  promptWordRows,
  type PromptHighlightMode,
  type PromptWordRange,
} from "../../../../src/core/teleprompter/model";
import type { LiveExpectedWord } from "../../../../src/core/teleprompter/live";
import type { RecordedWord } from "./store";

export type { PromptHighlightMode };

export interface BoothParagraph {
  text: string;
  tokens: ReturnType<typeof promptTextTokens>;
  firstWord: number;
  wordCount: number;
}

export function paragraphsFromHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const nodes = Array.from(doc.body.querySelectorAll("p, h1, h2, h3, li, blockquote"));
  const paras = nodes.map((node) => node.textContent?.trim() ?? "").filter(Boolean);
  if (paras.length) {
    return paras;
  }
  const text = doc.body.textContent?.trim();
  return text ? [text] : [];
}

export function buildBoothScript(paragraphs: string[]): {
  paragraphs: BoothParagraph[];
  expected: LiveExpectedWord[];
} {
  const expected: LiveExpectedWord[] = [];
  const built: BoothParagraph[] = [];
  for (let lineIndex = 0; lineIndex < paragraphs.length; lineIndex += 1) {
    const text = paragraphs[lineIndex];
    const tokens = promptTextTokens(text);
    const ends = promptSentenceEnds(text);
    const firstWord = expected.length;
    let wordCount = 0;
    for (const token of tokens) {
      if (!token.isWord) {
        continue;
      }
      expected.push({
        index: expected.length,
        lineIndex,
        text: token.text,
        endsSentence: ends[wordCount] === true,
      });
      wordCount += 1;
    }
    built.push({ text, tokens, firstWord, wordCount });
  }
  return { paragraphs: built, expected };
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
