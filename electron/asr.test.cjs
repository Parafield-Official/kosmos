const { segmentWords } = require("./asr.cjs");

describe("local Whisper JSON adapter", () => {
  it("turns segment offsets into deterministic word windows", () => {
    const words = segmentWords([
      {
        offsets: { from: 100, to: 900 },
        text: " the fox jumped",
      },
    ]);

    expect(words.map((word) => word.text)).toEqual(["the", "fox", "jumped"]);
    expect(words[0].start).toBeCloseTo(0.1, 5);
    expect(words.at(-1).end).toBeCloseTo(0.9, 5);
    expect(words.every((word) => word.confidence >= 0 && word.confidence <= 1)).toBe(true);
  });
});
