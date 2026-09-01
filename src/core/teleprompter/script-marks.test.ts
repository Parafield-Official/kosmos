import { describe, expect, it } from "vitest";
import type { GlossaryEntry } from "../project/types";
import { boothScriptFromParagraphs, decorateScriptSpans } from "./script-marks";

const daphne: GlossaryEntry = {
  id: "daphne",
  spelling: "Daphne",
  respell: "DAFF-nee",
  frequency: 4,
  source: "user",
};

describe("teleprompter script marks", () => {
  it("tints quoted dialogue without assigning a duet seat", () => {
    const spans = decorateScriptSpans([
      { text: "Then she said “Stay here,” and left.", seat: "narration", style: [] },
    ]);
    const spoken = spans.filter((span) => span.dialogue).map((span) => span.text).join("");
    const narration = spans.filter((span) => !span.dialogue).map((span) => span.text).join("");
    expect(spoken).toContain("Stay here");
    expect(narration).toContain("Then she said");
    expect(spans.filter((span) => span.dialogue).every((span) => span.seat === "narration")).toBe(true);
  });

  it("marks glossary names and keeps word order for voice follow", () => {
    const script = boothScriptFromParagraphs(
      ['“Stay, Daphne,” she whispered.', "The duke bowed."],
      [daphne],
    );
    expect(script.expected.map((word) => word.text)).toEqual([
      "Stay",
      "Daphne",
      "she",
      "whispered",
      "The",
      "duke",
      "bowed",
    ]);
    const daphneToken = script.paragraphs
      .flatMap((paragraph) => paragraph.tokens)
      .find((token) => token.text === "Daphne");
    expect(daphneToken).toMatchObject({ isWord: true, glossaryId: "daphne", dialogue: true });
    expect(script.cues).toEqual([{ entryId: "daphne", wordIndex: 1, lineIndex: 0 }]);
  });
});
