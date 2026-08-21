import { describe, expect, it } from "vitest";
import { alignTranscript, isSuppressedPickup, normalizeSuppressedWords } from "./align";
import type { TranscriptWord } from "./align";

function words(entries: Array<[string, number, number]>): TranscriptWord[] {
  return entries.map(([text, start, end]) => ({ text, start, end }));
}

describe("filtering a word for the whole book", () => {
  it("normalizes the filter list the way tokens are normalized", () => {
    const filter = normalizeSuppressedWords(["Léominster", "Half-Empty", "  ", "It's"]);
    expect(filter.has("leominster")).toBe(true);
    expect(filter.has("half")).toBe(true);
    expect(filter.has("empty")).toBe(true);
    expect(filter.has("it's")).toBe(true);
  });

  it("drops a pickup whose manuscript word is filtered", () => {
    const filter = normalizeSuppressedWords(["Leominster"]);
    expect(isSuppressedPickup({ expected: "Leominster", heard: "lemster", kind: "sub" }, filter)).toBe(true);
    expect(isSuppressedPickup({ expected: "Leominster", heard: "", kind: "skip" }, filter)).toBe(true);
  });

  it("keeps a merged pickup that also covers an unfiltered word", () => {
    // Filtering one word must not take the real problem beside it down too.
    const filter = normalizeSuppressedWords(["Leominster"]);
    expect(isSuppressedPickup({ expected: "Leominster road", heard: "lemster rope", kind: "sub" }, filter))
      .toBe(false);
  });

  it("judges an inserted word by what was heard, since it has no manuscript side", () => {
    const filter = normalizeSuppressedWords(["um"]);
    expect(isSuppressedPickup({ expected: "", heard: "um", kind: "insert" }, filter)).toBe(true);
    expect(isSuppressedPickup({ expected: "", heard: "um actually", kind: "insert" }, filter)).toBe(false);
  });

  it("never filters a long pause, which is about timing rather than a word", () => {
    const filter = normalizeSuppressedWords(["Pause"]);
    expect(isSuppressedPickup({ expected: "Pause > 4s", heard: "", kind: "pause" }, filter)).toBe(false);
  });

  it("leaves the same chapter clean on the next check", () => {
    const input = {
      chapterId: "ch01",
      manuscript: "The Leominster road was flooded.",
      transcript: words([
        ["The", 0.1, 0.3],
        ["lemster", 0.4, 0.8],
        ["road", 0.9, 1.1],
        ["was", 1.2, 1.4],
        ["flooded", 1.5, 1.9],
      ]),
      durationSeconds: 2,
    };
    expect(alignTranscript(input).pickups).toHaveLength(1);
    expect(alignTranscript({ ...input, suppressedWords: ["Leominster"] }).pickups).toEqual([]);
  });

  it("still reports a neighbouring problem, filter or not", () => {
    // "Road" read as "lane" is next to the filtered word, so the two land in
    // one run. The pickup has to survive and still name the word that is wrong,
    // because that span needs re-recording either way.
    const result = alignTranscript({
      chapterId: "ch01",
      manuscript: "The Leominster road was flooded.",
      transcript: words([
        ["The", 0.1, 0.3],
        ["lemster", 0.4, 0.8],
        ["lane", 0.9, 1.1],
        ["was", 1.2, 1.4],
        ["flooded", 1.5, 1.9],
      ]),
      durationSeconds: 2,
      suppressedWords: ["Leominster"],
    });
    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0].expected).toBe("Leominster road");
  });

  it("reports a problem elsewhere in the chapter while the filtered word stays quiet", () => {
    const result = alignTranscript({
      chapterId: "ch01",
      manuscript: "The Leominster road was flooded and the bridge was gone.",
      transcript: words([
        ["The", 0.1, 0.3],
        ["lemster", 0.4, 0.8],
        ["road", 0.9, 1.1],
        ["was", 1.2, 1.4],
        ["flooded", 1.5, 1.9],
        ["and", 2, 2.2],
        ["the", 2.3, 2.4],
        ["bridge", 2.5, 2.8],
        ["was", 2.9, 3],
        ["down", 3.1, 3.4],
      ]),
      durationSeconds: 4,
      suppressedWords: ["Leominster"],
    });
    expect(result.pickups.map((pickup) => pickup.expected)).toEqual(["gone"]);
  });
});
