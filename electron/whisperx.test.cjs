const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildWhisperXArgs,
  parseWhisperXWords,
  resolveWhisperXCommand,
  transcribeImportedAudio,
} = require("./whisperx.cjs");

describe("WhisperX imported-audio alignment", () => {
  it("prefers the bundled onedir runtime shipped inside app resources", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kosmos-whisperx-runtime-"));
    const executable = path.join(root, "whisperx", process.platform === "win32" ? "whisperx.exe" : "whisperx");
    try {
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, "bundled runtime", "utf8");

      expect(resolveWhisperXCommand({
        resourcesPath: root,
        appPath: "/missing/app",
        cwd: "/missing/cwd",
        env: {},
        requireBundled: true,
      })).toBe(executable);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs local CPU alignment with JSON word output and no diarization", () => {
    expect(buildWhisperXArgs({
      audioPath: "/books/chapter.wav",
      outputDir: "/tmp/aligned",
      modelDir: "/models/whisperx",
      language: "en",
    })).toEqual([
      "/books/chapter.wav",
      "--model", "small.en",
      "--language", "en",
      "--device", "cpu",
      "--compute_type", "int8",
      "--batch_size", "4",
      "--vad_method", "silero",
      "--output_dir", "/tmp/aligned",
      "--output_format", "json",
      "--model_dir", "/models/whisperx",
      "--verbose", "False",
      "--print_progress", "False",
    ]);
  });

  it("converts forced-aligned words to Kosmos transcript timing", () => {
    expect(parseWhisperXWords({
      word_segments: [
        { word: " At", start: 2.32, end: 2.48, score: 0.97 },
        { word: "dusk", start: 2.49, end: 2.81, score: 0.91 },
        { word: "sky.", start: 5.12, end: 5.52, score: 0.88 },
      ],
    })).toEqual([
      { text: "At", start: 2.32, end: 2.48, confidence: 0.97 },
      { text: "dusk", start: 2.49, end: 2.81, confidence: 0.91 },
      { text: "sky", start: 5.12, end: 5.52, confidence: 0.88 },
    ]);
  });

  it("falls back to bundled Whisper when WhisperX is unavailable", async () => {
    const fallback = {
      engine: "whisper.cpp",
      modelPath: "/models/small.en.bin",
      words: [{ text: "fallback", start: 0, end: 0.5, confidence: 0.7 }],
    };
    const result = await transcribeImportedAudio({
      alignWithWhisperX: async () => { throw new Error("whisperx not found"); },
      transcribeWithWhisper: async () => fallback,
    });

    expect(result).toMatchObject({
      ...fallback,
      timingEngine: "whisper.cpp",
      alignmentFallback: true,
    });
  });

  it("uses WhisperX timings without running the fallback recognizer", async () => {
    let fallbackRuns = 0;
    const result = await transcribeImportedAudio({
      alignWithWhisperX: async () => ({
        engine: "whisperx",
        modelPath: "/models/whisperx",
        words: [{ text: "aligned", start: 1.1, end: 1.5, confidence: 0.94 }],
      }),
      transcribeWithWhisper: async () => {
        fallbackRuns += 1;
        throw new Error("should not run");
      },
    });

    expect(result).toMatchObject({
      engine: "whisperx",
      timingEngine: "whisperx",
      alignmentFallback: false,
    });
    expect(fallbackRuns).toBe(0);
  });
});
