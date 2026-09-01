import { describe, expect, it } from "vitest";
import { promptSentenceEnds } from "./model";
import {
  pickupLineRange,
  pickupLineSeconds,
  pickupLineText,
  pickupPrerollStart,
  trimPickupLineSilence,
  sentenceWordRange,
  type PickupLineWord,
} from "./pickup-line";

/** Build the word list the teleprompter hands to the matcher, from paragraphs. */
function wordsFrom(paragraphs: string[]): PickupLineWord[] {
  let index = 0;
  return paragraphs.flatMap((text, lineIndex) => {
    const ends = promptSentenceEnds(text);
    return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).map((word, offset) => ({
      index: index++,
      lineIndex,
      text: word,
      endsSentence: ends[offset] === true,
    }));
  });
}

describe("sentence ends", () => {
  it("closes a sentence on terminal punctuation but not on an abbreviation or an initial", () => {
    expect(promptSentenceEnds("The fox ran. It stopped."))
      .toEqual([false, false, true, false, true]);
    expect(promptSentenceEnds("Mr. Fox met Dr. Hare at St. Giles."))
      .toEqual([false, false, false, false, false, false, false, true]);
    expect(promptSentenceEnds("She read J. R. R. Tolkien aloud."))
      .toEqual([false, false, false, false, false, false, true]);
  });

  it("closes the last sentence of a paragraph whether or not it is punctuated", () => {
    // A heading carries no full stop, but it is still where a narrator restarts,
    // so a pickup on it must not run into the prose below.
    expect(promptSentenceEnds("Chapter One")).toEqual([false, true]);
  });
});

describe("pickup lines", () => {
  const words = wordsFrom([
    "The moon hangs small and yellow. The sea glides along far below.",
    "Francesca turned away.",
  ]);

  it("covers the sentence around a word, not the paragraph", () => {
    // "small" is index 3, inside the first of two sentences on the line.
    expect(sentenceWordRange(words, 3)).toEqual({ from: 0, to: 5 });
    expect(pickupLineText(words, sentenceWordRange(words, 3)))
      .toBe("The moon hangs small and yellow");

    expect(sentenceWordRange(words, 8)).toEqual({ from: 6, to: 11 });
    expect(pickupLineText(words, sentenceWordRange(words, 8)))
      .toBe("The sea glides along far below");
  });

  it("stops at a paragraph edge instead of running into the next line", () => {
    const range = sentenceWordRange(words, 13);
    expect(range).toEqual({ from: 12, to: 14 });
    expect(pickupLineText(words, range)).toBe("Francesca turned away");
  });

  it("widens by whole sentences when context is asked for", () => {
    // ACX asks narrators to re-record the sentences either side of the error.
    expect(pickupLineRange(words, 8, 1)).toEqual({ from: 0, to: 14 });
    // And it cannot run off either end of the chapter.
    expect(pickupLineRange(words, 0, 3)).toEqual({ from: 0, to: 14 });
  });

  it("returns nothing for a word index that is not in the chapter", () => {
    expect(sentenceWordRange(words, 99)).toBeNull();
    expect(pickupLineRange(words, -1)).toBeNull();
    expect(pickupLineText(words, null)).toBe("");
  });
});

describe("pickup audio bounds", () => {
  it("uses measured sentence words instead of assuming a narration pace", () => {
    expect(pickupLineSeconds([
      { start: 10, end: 10.4 },
      { start: 13.8, end: 14.3 },
      { start: 20, end: 20.6 },
    ])).toEqual({ start: 10, end: 20.6 });
  });

  it("falls back to the measured flagged word when no sentence words are available", () => {
    expect(pickupLineSeconds([], { start: 0.2, end: 0.5 })).toEqual({
      start: 0.2,
      end: 0.5,
    });
  });

  it("rolls back a lead-in so the narrator hears the read they are matching", () => {
    expect(pickupPrerollStart(20)).toBe(17);
    expect(pickupPrerollStart(20, 5)).toBe(15);
  });

  it("trims room tone at the line edges while retaining breath room", () => {
    expect(trimPickupLineSilence(
      { start: 0, end: 20 },
      [{ start: 0, end: 4.8 }, { start: 14.7, end: 20 }],
    )).toEqual({
      start: 4.8,
      end: 14.7,
    });
  });
});
