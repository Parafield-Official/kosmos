import { describe, expect, it } from "vitest";
import { alignManuscriptTokens, type TranscriptWord } from "./align";

function words(items: Array<[string, number, number]>): TranscriptWord[] {
  return items.map(([text, start, end]) => ({ text, start, end, confidence: 0.97 }));
}

function heardFor(
  manuscript: string,
  transcript: TranscriptWord[],
  written: string,
): string[] {
  return alignManuscriptTokens(manuscript, transcript)
    .filter((alignment) => alignment.written.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()
      === written.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase())
    .map((alignment) => alignment.heard);
}

describe("alignManuscriptTokens", () => {
  it("reports the spoken word and its timing at every matching token", () => {
    const alignments = alignManuscriptTokens(
      "The fox ran.",
      words([["The", 0.1, 0.25], ["fox", 0.3, 0.5], ["ran", 0.55, 0.8]]),
    );
    expect(alignments).toHaveLength(3);
    expect(alignments[1]).toMatchObject({ written: "fox", heard: "fox" });
    expect(alignments[1].start).toBeCloseTo(0.3, 5);
    expect(alignments[1].end).toBeCloseTo(0.5, 5);
  });

  it("reports what was said instead when one word is misread", () => {
    expect(heardFor(
      "She left Leominster at dawn.",
      words([
        ["She", 0.1, 0.3],
        ["left", 0.35, 0.5],
        ["lemster", 0.6, 1.1],
        ["at", 1.2, 1.3],
        ["dawn", 1.35, 1.6],
      ]),
      "Leominster",
    )).toEqual(["lemster"]);
  });

  it("keeps one written word that was read as several spoken words", () => {
    expect(heardFor(
      "The Leominster road.",
      words([
        ["The", 0.1, 0.2],
        ["lemon", 0.3, 0.6],
        ["stir", 0.65, 0.9],
        ["road", 1.0, 1.3],
      ]),
      "Leominster",
    )).toEqual(["lemon stir"]);
  });

  it("reports nothing heard where a word was skipped", () => {
    expect(heardFor(
      "The quick brown fox.",
      words([["The", 0.1, 0.2], ["quick", 0.3, 0.5], ["fox", 0.6, 0.9]]),
      "brown",
    )).toEqual([""]);
  });

  it("pairs a run of misreads word for word instead of merging them", () => {
    const alignments = alignManuscriptTokens(
      "He saw the grey stone tower.",
      words([
        ["He", 0.1, 0.2],
        ["saw", 0.25, 0.4],
        ["the", 0.45, 0.55],
        ["gray", 0.6, 0.8],
        ["stony", 0.85, 1.1],
        ["tower", 1.15, 1.4],
      ]),
    );
    const grey = alignments.find((alignment) => alignment.written === "grey");
    const stone = alignments.find((alignment) => alignment.written === "stone");
    expect(grey?.heard).toBe("gray");
    expect(stone?.heard).toBe("stony");
  });

  it("does not invent a pairing across a garbled stretch", () => {
    const alignments = alignManuscriptTokens(
      "One two three four five six seven.",
      words([
        ["one", 0.1, 0.2],
        ["mumble", 0.3, 0.5],
        ["mumble", 0.55, 0.7],
        ["seven", 0.8, 1.0],
      ]),
    );
    const middle = alignments.filter((alignment) =>
      ["two", "three", "four", "five", "six"].includes(alignment.written.toLowerCase()));
    expect(middle).toHaveLength(5);
    for (const alignment of middle) {
      expect(alignment.heard).toBe("");
    }
  });

  it("reports the whole spoken figure at each token of a number", () => {
    const alignments = alignManuscriptTokens(
      "It was 1999 then.",
      words([
        ["It", 0.1, 0.2],
        ["was", 0.25, 0.4],
        ["nineteen", 0.5, 0.8],
        ["ninety", 0.85, 1.1],
        ["nine", 1.15, 1.3],
        ["then", 1.4, 1.6],
      ]),
    );
    const number = alignments.find((alignment) => alignment.written === "1999");
    expect(number?.heard).toBe("nineteen ninety nine");
    expect(number?.start).toBeCloseTo(0.5, 5);
    expect(number?.end).toBeCloseTo(1.3, 5);
  });

  it("covers every hyphenated piece of a compound with one reading", () => {
    const alignments = alignManuscriptTokens(
      "A half-empty glass.",
      words([
        ["A", 0.1, 0.2],
        ["half", 0.3, 0.5],
        ["empty", 0.55, 0.9],
        ["glass", 1.0, 1.3],
      ]),
    );
    const compound = alignments.find((alignment) => alignment.written === "half-empty");
    expect(compound?.heard).toBe("half empty");
  });

  it("returns a token per manuscript word when there is no audio at all", () => {
    const alignments = alignManuscriptTokens("The fox ran.", []);
    expect(alignments.map((alignment) => alignment.written)).toEqual(["The", "fox", "ran"]);
    for (const alignment of alignments) {
      expect(alignment.heard).toBe("");
      expect(alignment.start).toBeUndefined();
    }
  });

  it("ignores blank recogniser entries rather than shifting the alignment", () => {
    const alignments = alignManuscriptTokens(
      "The fox ran.",
      words([
        ["The", 0.1, 0.2],
        ["   ", 0.2, 0.22],
        ["fox", 0.3, 0.5],
        ["ran", 0.55, 0.8],
      ]),
    );
    expect(alignments.map((alignment) => alignment.heard)).toEqual(["The", "fox", "ran"]);
  });
});
