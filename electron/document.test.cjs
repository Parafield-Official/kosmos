const { normalizeChapterDocument } = require("./document.cjs");

describe("chapter document persistence boundary", () => {
  it("normalizes style metadata while retaining script text", () => {
    expect(normalizeChapterDocument({
      spans: [{ text: "Hello", seat: "narration", style: ["bold", "unknown"] }],
    })).toEqual({
      schema: 1,
      spans: [{ text: "Hello", seat: "narration", style: ["bold"] }],
    });
  });

  it("rejects malformed spans before manuscript actions run", () => {
    expect(() => normalizeChapterDocument({ spans: [{ text: 42, seat: "narration" }] }))
      .toThrow(/span/i);
  });

  it("rejects an unknown document schema instead of silently rewriting it", () => {
    expect(() => normalizeChapterDocument({ schema: 9, spans: [] })).toThrow(/schema/i);
  });

  it("retains valid narrator performance cues and drops malformed ones", () => {
    expect(normalizeChapterDocument({
      spans: [
        { text: "Wait", seat: "narration", style: [], performance_cue: { kind: "beat", label: "  let it land  " } },
        { text: "Now", seat: "narration", style: [], performance_cue: { kind: "teleport", label: "bad" } },
      ],
    }).spans).toEqual([
      { text: "Wait", seat: "narration", style: [], performance_cue: { kind: "beat", label: "let it land" } },
      { text: "Now", seat: "narration", style: [] },
    ]);
  });
});
