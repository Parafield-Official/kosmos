import { describe, expect, it } from "vitest";
import { inlineMarkdown, manuscriptBlocks, transcriptBlocks } from "./paper";

describe("manuscript paper blocks", () => {
  it("splits blank-line paragraphs and keeps a chapter heading", () => {
    const blocks = manuscriptBlocks([
      "Chapter 1",
      "",
      "The Bridgertons are the most prolific family in London.",
      "They fill every ballroom.",
      "",
      "Daphne stood by the window.",
    ].join("\n"));

    expect(blocks.map((block) => [block.kind, block.text])).toEqual([
      ["heading", "Chapter 1"],
      ["paragraph", "The Bridgertons are the most prolific family in London. They fill every ballroom."],
      ["paragraph", "Daphne stood by the window."],
    ]);
  });

  it("treats leftover markdown heading markers as a heading, not a hash", () => {
    const blocks = manuscriptBlocks("   The opening scene\n\nShe crossed the room.");
    expect(blocks[0]).toMatchObject({ kind: "heading", text: "The opening scene", level: 2 });
    expect(blocks[1]).toMatchObject({ kind: "paragraph", text: "She crossed the room." });
  });

  it("marks **bold** and *italic* without eating the rest of the sentence", () => {
    expect(inlineMarkdown("A **very** *quiet* _room_.")).toEqual([
      { kind: "text", text: "A " },
      { kind: "strong", text: "very" },
      { kind: "text", text: " " },
      { kind: "em", text: "quiet" },
      { kind: "text", text: " " },
      { kind: "em", text: "room" },
      { kind: "text", text: "." },
    ]);
  });
});

describe("transcript paper blocks", () => {
  it("leaves a short heard line as one paragraph", () => {
    expect(transcriptBlocks("to quote someone like her")).toEqual([
      {
        kind: "paragraph",
        text: "to quote someone like her",
        inlines: [{ kind: "text", text: "to quote someone like her" }],
      },
    ]);
  });

  it("breaks a Whisper wall into readable paragraphs without changing words", () => {
    const words = Array.from({ length: 200 }, (_, index) => `w${index + 1}`);
    const blocks = transcriptBlocks(words.join(" "));
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.text.split(" ")).toHaveLength(90);
    expect(blocks[1]?.text.split(" ")).toHaveLength(90);
    expect(blocks[2]?.text.split(" ")).toHaveLength(20);
    expect(blocks.map((block) => block.text).join(" ")).toBe(words.join(" "));
  });
});
