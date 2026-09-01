import { linkGlossarySpans } from "../glossary/candidates";
import { inferDialogueSpans } from "../manuscript/import";
import type { GlossaryEntry, ScriptSpan, Seat } from "../project/types";
import type { LiveExpectedWord } from "./live";
import { buildPromptLines, promptSentenceEnds, promptTextTokens, type PromptTextToken } from "./model";
import type { PromptPronunciationCue } from "../glossary/workflow";

export interface BoothMarkToken extends PromptTextToken {
  dialogue?: boolean;
  seat?: Seat;
  style: ScriptSpan["style"];
  glossaryId?: string;
}

export interface BoothMarkedParagraph {
  text: string;
  tokens: BoothMarkToken[];
  firstWord: number;
  wordCount: number;
}

export interface BoothMarkedScript {
  paragraphs: BoothMarkedParagraph[];
  expected: LiveExpectedWord[];
  cues: PromptPronunciationCue[];
}

/** Quote-mark voices and glossary names onto manuscript spans. */
export function decorateScriptSpans(spans: ScriptSpan[], glossary: GlossaryEntry[] = []): ScriptSpan[] {
  return linkGlossarySpans(inferDialogueSpans(spans), glossary);
}

export function spansFromParagraphs(paragraphs: string[]): ScriptSpan[] {
  const spans: ScriptSpan[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (index > 0) {
      spans.push({ text: "\n", seat: "narration", style: [] });
    }
    spans.push({ text: paragraphs[index], seat: "narration", style: [] });
  }
  return spans;
}

export function boothScriptFromSpans(spans: ScriptSpan[]): BoothMarkedScript {
  const lines = buildPromptLines(spans);
  const expected: LiveExpectedWord[] = [];
  const cues: PromptPronunciationCue[] = [];
  const paragraphs: BoothMarkedParagraph[] = [];
  let lastGlossaryId: string | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const tokens: BoothMarkToken[] = [];
    const firstWord = expected.length;
    const ends = promptSentenceEnds(line.text);
    let wordCount = 0;
    for (const segment of line.segments) {
      for (const token of promptTextTokens(segment.text)) {
        tokens.push({
          ...token,
          dialogue: segment.dialogue,
          seat: segment.seat,
          style: [...segment.style],
          glossaryId: segment.glossary_id,
        });
        if (!token.isWord) {
          continue;
        }
        if (segment.glossary_id && segment.glossary_id !== lastGlossaryId) {
          cues.push({
            entryId: segment.glossary_id,
            wordIndex: expected.length,
            lineIndex,
          });
        }
        lastGlossaryId = segment.glossary_id;
        expected.push({
          index: expected.length,
          lineIndex,
          text: token.text,
          endsSentence: ends[wordCount] === true,
        });
        wordCount += 1;
      }
    }
    paragraphs.push({ text: line.text, tokens, firstWord, wordCount });
  }

  return { paragraphs, expected, cues };
}

export function boothScriptFromParagraphs(
  paragraphs: string[],
  glossary: GlossaryEntry[] = [],
): BoothMarkedScript {
  return boothScriptFromSpans(decorateScriptSpans(spansFromParagraphs(paragraphs), glossary));
}
