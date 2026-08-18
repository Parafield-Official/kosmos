import type { TranscriptWord } from "./align";
import { normalizeToken, tokenizeManuscript } from "./normalize";

export interface WordOccurrence {
  text: string;
  start: number;
  end: number;
  transcriptStart: number;
  transcriptEnd: number;
  context: string;
}

/** Find a word or phrase in timestamped speech without changing display text. */
export function findWordOccurrences(
  transcript: TranscriptWord[],
  query: string,
  contextWords = 4,
): WordOccurrence[] {
  const queryTokens = tokenizeManuscript(query).map((token) => token.value);
  if (queryTokens.length === 0) {
    return [];
  }
  const validTranscript = transcript
    .map((word, originalIndex) => ({
      ...word,
      originalIndex,
      value: normalizeToken(word.text),
    }))
    .filter((word) =>
      word.value.length > 0
      && Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.start >= 0
      && word.end >= word.start,
    );
  const radius = Number.isFinite(contextWords) ? Math.max(0, Math.floor(contextWords)) : 4;
  const results: WordOccurrence[] = [];

  for (let index = 0; index <= validTranscript.length - queryTokens.length; index += 1) {
    const matched = queryTokens.every((token, offset) => validTranscript[index + offset]?.value === token);
    if (!matched) {
      continue;
    }
    const lastIndex = index + queryTokens.length - 1;
    const first = validTranscript[index];
    const last = validTranscript[lastIndex];
    const contextStart = Math.max(0, index - radius);
    const contextEnd = Math.min(validTranscript.length, lastIndex + radius + 1);
    results.push({
      text: validTranscript.slice(index, lastIndex + 1).map((word) => word.text).join(" "),
      start: first.start,
      end: last.end,
      transcriptStart: first.originalIndex,
      transcriptEnd: last.originalIndex,
      context: validTranscript.slice(contextStart, contextEnd).map((word) => word.text).join(" "),
    });
  }
  return results;
}
