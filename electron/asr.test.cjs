const { buildPcmConversionArgs, buildWhisperArgs, parseWhisperTime, segmentWords } = require("./asr.cjs");

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

  it("normalizes every accepted source through a local PCM16 conversion", () => {
    expect(buildPcmConversionArgs("book.m4a", "/tmp/booth/input.wav")).toEqual([
      "-y", "-v", "error", "-i", "book.m4a",
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "/tmp/booth/input.wav",
    ]);
  });

  it("accepts Whisper timestamps with or without fractional seconds", () => {
    expect(parseWhisperTime(undefined, "00:01:02")).toBe(62);
    expect(parseWhisperTime(undefined, "01:02.5")).toBe(62.5);
    expect(parseWhisperTime(undefined, "00:00:01,250")).toBe(1.25);
  });

  it("uses greedy decoding for low-latency listen-only windows", () => {
    expect(buildWhisperArgs({
      modelPath: "/models/small.en.bin",
      inputPath: "/tmp/window.wav",
      outputBase: "/tmp/transcript",
      language: "en",
      live: true,
      threads: 6,
    })).toEqual([
      "-m", "/models/small.en.bin",
      "-f", "/tmp/window.wav",
      "-l", "en",
      "-oj", "-of", "/tmp/transcript", "-np",
      "-t", "6", "-bs", "1", "-bo", "1", "-fa", "-sow",
    ]);
  });

  it("uses token-level timestamps when the Whisper JSON includes them", () => {
    const words = segmentWords([{
      text: "fallback text",
      offsets: { from: 0, to: 2000 },
      tokens: [
        { text: "alpha", offsets: { from: 100, to: 450 }, p: 0.91 },
        { text: " beta", offsets: { from: 500, to: 900 }, p: 0.88 },
      ],
    }]);
    expect(words).toEqual([
      { text: "alpha", start: 0.1, end: 0.45, confidence: 0.91 },
      { text: "beta", start: 0.5, end: 0.9, confidence: 0.88 },
    ]);
  });

  it("falls back to segment timing when token entries omit timing metadata", () => {
    const words = segmentWords([{
      offsets: { from: 1000, to: 3000 },
      text: "alpha beta",
      tokens: [{ text: "alpha" }, { text: " beta" }],
    }]);

    expect(words.map((word) => word.text)).toEqual(["alpha", "beta"]);
    expect(words[0].start).toBeCloseTo(1, 5);
    expect(words.at(-1).end).toBeCloseTo(3, 5);
  });

  it("rejects malformed Whisper JSON instead of iterating an object as segments", () => {
    expect(() => segmentWords({ text: "not an array" })).toThrow(/transcription array/i);
  });
});
