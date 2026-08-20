const { buildPcmConversionArgs, buildWhisperArgs, findLiveModel, parseWhisperTime, segmentWords } = require("./asr.cjs");
const { LIVE_MODEL } = require("./model.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

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

  it("uses full JSON with greedy decoding for low-latency follow windows", () => {
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
      "-ojf", "-of", "/tmp/transcript", "-np",
      "-t", "6", "-bs", "1", "-bo", "1", "-fa", "-sow",
    ]);
  });

  it("keeps beam-5 accuracy for Whisper QC CLI fallback", () => {
    expect(buildWhisperArgs({
      modelPath: "/models/small.en.bin",
      inputPath: "/tmp/window.wav",
      outputBase: "/tmp/transcript",
      language: "en",
      live: true,
      quality: true,
      threads: 4,
    })).toEqual([
      "-m", "/models/small.en.bin",
      "-f", "/tmp/window.wav",
      "-l", "en",
      "-ojf", "-of", "/tmp/transcript", "-np",
      "-t", "4", "-bs", "5", "-bo", "5", "-sow",
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

  it("filters full-JSON control tokens without losing word probabilities", () => {
    const words = segmentWords([{
      text: " the fox",
      offsets: { from: 0, to: 500 },
      tokens: [
        { text: "[_BEG_]", offsets: { from: 0, to: 0 }, p: 0.99 },
        { text: " the", offsets: { from: 10, to: 190 }, p: 0.94 },
        { text: " fox", offsets: { from: 190, to: 400 }, p: 0.97 },
        { text: "[_TT_20]", offsets: { from: 400, to: 400 }, p: 0.02 },
      ],
    }]);
    expect(words).toEqual([
      { text: "the", start: 0.01, end: 0.19, confidence: 0.94 },
      { text: "fox", start: 0.19, end: 0.4, confidence: 0.97 },
    ]);
  });

  it("merges Whisper full-JSON subword pieces into spoken words", () => {
    const words = segmentWords([{
      offsets: { from: 0, to: 1000 },
      tokens: [
        { text: " the", offsets: { from: 0, to: 120 }, p: 0.99 },
        { text: " che", offsets: { from: 120, to: 260 }, p: 0.99 },
        { text: "v", offsets: { from: 260, to: 330 }, p: 0.98 },
        { text: "rons", offsets: { from: 330, to: 520 }, p: 0.97 },
        { text: " of", offsets: { from: 600, to: 720 }, p: 0.99 },
      ],
    }]);
    expect(words).toEqual([
      { text: "the", start: 0, end: 0.12, confidence: 0.99 },
      { text: "chevrons", start: 0.12, end: 0.52, confidence: 0.97 },
      { text: "of", start: 0.6, end: 0.72, confidence: 0.99 },
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

describe("live follow model lookup", () => {
  it("ignores an unmarked or wrong live model file", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-live-model-"));
    try {
      const models = path.join(folder, "models");
      await fs.mkdir(models, { recursive: true });
      await fs.writeFile(path.join(models, LIVE_MODEL.fileName), Buffer.from("fixture"));
      await expect(findLiveModel({ userDataPath: folder, resourcesPath: folder, appPath: folder })).resolves.toBeNull();
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});
