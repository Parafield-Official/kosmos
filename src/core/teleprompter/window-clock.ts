import type { LiveTranscriptWord } from "./live";

/** Clip recognizers restart at zero; matching and tape markers use the take clock. */
export function placeWindowOnTake(
  words: LiveTranscriptWord[],
  windowStartSeconds: number,
): LiveTranscriptWord[] {
  return words.map((word) => ({
    ...word,
    start: word.start + windowStartSeconds,
    end: word.end + windowStartSeconds,
  }));
}
