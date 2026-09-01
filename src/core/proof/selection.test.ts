import { describe, expect, it } from "vitest";
import { tokenizeManuscript } from "./normalize";
import {
  alignedManuscriptTokens,
  buildNarrationRedoRanges,
  createNarratorRedoPickup,
} from "./selection";
import type { TranscriptWord } from "./align";

function timedWords(text: string, start = 0): TranscriptWord[] {
  return text.split(/\s+/u).map((word, index) => ({
    text: word,
    start: start + index * 0.4,
    end: start + index * 0.4 + 0.3,
    confidence: 0.96,
  }));
}

describe("manuscript-aware narration transcript", () => {
  it("keeps manuscript structure while attaching what Whisper heard to each written token", () => {
    const manuscript = "Leaflets\n\nThe moon hangs small and gibbous.";
    const aligned = alignedManuscriptTokens(
      manuscript,
      timedWords("The moon hangs small and gibious", 1),
    );

    expect(aligned.map((token) => token.written)).toEqual([
      "Leaflets", "The", "moon", "hangs", "small", "and", "gibbous",
    ]);
    expect(aligned[0]).toMatchObject({ written: "Leaflets", state: "missing" });
    expect(aligned[6]).toMatchObject({
      written: "gibbous",
      heard: "gibious",
      state: "different",
      start: 3,
      end: 3.3,
    });
  });

  it("does not rewrite capitalization or punctuation on matching manuscript words", () => {
    const aligned = alignedManuscriptTokens(
      "France. Intercoms crackle.",
      timedWords("france intercoms crackle"),
    );
    expect(aligned.map((token) => token.display)).toEqual(["France", "Intercoms", "crackle"]);
    expect(aligned.every((token) => token.state === "matched")).toBe(true);
  });
});

describe("narrator-selected redo ranges", () => {
  const manuscript = [
    "Leaflets",
    "",
    "At dusk they pour from the sky. The moon hangs small and yellow and gibbous.",
    "",
    "Bombers",
    "",
    "They cross the Channel at midnight.",
  ].join("\n");
  const spoken = "At dusk they pour from the sky The moon hangs small and yellow and gibbous They cross the Channel at midnight";
  const transcript = timedWords(spoken, 2);
  const tokens = tokenizeManuscript(manuscript);
  const moon = tokens.find((token) => token.text === "moon")?.index ?? -1;

  it("keeps an exact word selection exact and maps it to that word's audio", () => {
    const ranges = buildNarrationRedoRanges({ manuscript, transcript, fromToken: moon, toToken: moon });
    expect(ranges.selection).toMatchObject({
      scope: "selection",
      fromToken: moon,
      toToken: moon,
      text: "moon",
      wordCount: 1,
      timing: "ready",
    });
    expect(ranges.selection.start).toBeCloseTo(5.2, 5);
    expect(ranges.selection.end).toBeCloseTo(5.5, 5);
  });

  it("offers sentence and paragraph expansion without silently changing the selection", () => {
    const ranges = buildNarrationRedoRanges({ manuscript, transcript, fromToken: moon, toToken: moon });
    expect(ranges.sentence.text).toBe("The moon hangs small and yellow and gibbous.");
    expect(ranges.paragraph.text).toBe("At dusk they pour from the sky. The moon hangs small and yellow and gibbous.");
    expect(ranges.selection.text).toBe("moon");
    expect(ranges.sentence.fromToken).toBeGreaterThan(ranges.paragraph.fromToken);
  });

  it("marks a partly aligned range as uncertain instead of inventing timestamps", () => {
    const shortTranscript = timedWords("At dusk they pour from the sky The moon hangs small and yellow", 2);
    const ranges = buildNarrationRedoRanges({ manuscript, transcript: shortTranscript, fromToken: moon, toToken: moon + 6 });
    expect(ranges.selection.timing).toBe("partial");
    expect(ranges.selection.start).toBeDefined();
    expect(ranges.selection.end).toBeDefined();
  });

  it("blocks a range with no mapped speech", () => {
    const heading = tokens.find((token) => token.text === "Leaflets")?.index ?? 0;
    const ranges = buildNarrationRedoRanges({ manuscript, transcript, fromToken: heading, toToken: heading });
    expect(ranges.selection).toMatchObject({ timing: "unavailable" });
    expect(ranges.selection.start).toBeUndefined();
    expect(ranges.selection.end).toBeUndefined();
  });

  it("creates a performance pickup against the chosen recording", () => {
    const range = buildNarrationRedoRanges({ manuscript, transcript, fromToken: moon, toToken: moon }).sentence;
    const pickup = createNarratorRedoPickup({
      chapterId: "ch01",
      range,
      sourceKind: "take",
      reason: "More emotion",
    });
    expect(pickup).toMatchObject({
      chapter_id: "ch01",
      expected: "The moon hangs small and yellow and gibbous.",
      heard: "The moon hangs small and yellow and gibbous.",
      kind: "sub",
      status: "open",
      intent: "performance",
      selection_kind: "sentence",
      source_kind: "take",
      note: "More emotion",
    });
    expect(pickup.line_start).toBe(pickup.t_start);
    expect(pickup.line_end).toBe(pickup.t_end);
  });

  it("refuses to create an edit when the selected text has no audio mapping", () => {
    const heading = tokens.find((token) => token.text === "Leaflets")?.index ?? 0;
    const range = buildNarrationRedoRanges({ manuscript, transcript, fromToken: heading, toToken: heading }).selection;
    expect(() => createNarratorRedoPickup({ chapterId: "ch01", range, sourceKind: "take" }))
      .toThrow(/timed audio/i);
  });
});
