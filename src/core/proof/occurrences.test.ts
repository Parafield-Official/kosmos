import { describe, expect, it } from "vitest";
import { findWordOccurrences } from "./occurrences";

describe("proof word occurrences", () => {
  const transcript = [
    { text: "The", start: 0.1, end: 0.3 },
    { text: "little", start: 0.4, end: 0.7 },
    { text: "house", start: 0.8, end: 1.1 },
    { text: "waited", start: 1.4, end: 1.8 },
    { text: "by", start: 2.0, end: 2.1 },
    { text: "the", start: 2.2, end: 2.4 },
    { text: "little", start: 2.5, end: 2.8 },
    { text: "house.", start: 2.9, end: 3.2 },
  ];

  it("finds every repeated phrase and keeps its audio range", () => {
    expect(findWordOccurrences(transcript, "little house")).toEqual([
      expect.objectContaining({
        text: "little house",
        start: 0.4,
        end: 1.1,
        transcriptStart: 1,
        transcriptEnd: 2,
      }),
      expect.objectContaining({
        text: "little house.",
        start: 2.5,
        end: 3.2,
        transcriptStart: 6,
        transcriptEnd: 7,
      }),
    ]);
  });

  it("matches punctuation and case without changing displayed transcript text", () => {
    const result = findWordOccurrences(transcript, "HOUSE");
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.text)).toEqual(["house", "house."]);
  });

  it("returns no ranges for blank or absent queries", () => {
    expect(findWordOccurrences(transcript, "   ")).toEqual([]);
    expect(findWordOccurrences(transcript, "mermaid")).toEqual([]);
  });
});
