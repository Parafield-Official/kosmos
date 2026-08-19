const { EventEmitter } = require("node:events");
const {
  PersistentWhisperServer,
  buildWhisperServerArgs,
  normalizeServerResult,
} = require("./asr-server.cjs");

describe("persistent Whisper server adapter", () => {
  it("binds only to loopback and uses official beam-5 QC decoding", () => {
    expect(buildWhisperServerArgs({
      serverPath: "/vendor/bin/whisper-server",
      modelPath: "/models/small.en.bin",
      port: 43210,
      requestPath: "/kosmos-live-test",
      threads: 6,
    })).toEqual([
      "-m", "/models/small.en.bin",
      "-t", "6",
      "-bo", "5",
      "-bs", "5",
      "-sow",
      "-sns",
      "--host", "127.0.0.1",
      "--port", "43210",
      "--request-path", "/kosmos-live-test",
    ]);
    expect(buildWhisperServerArgs({
      modelPath: "/models/small.en.bin",
      port: 43210,
      requestPath: "/kosmos-live-test",
      threads: 2,
      useGpu: false,
    })).toContain("-ng");
  });

  it("maps verbose JSON word timestamps and removes punctuation tokens", () => {
    expect(normalizeServerResult({
      segments: [{
        words: [
          { word: " the", start: 0.01, end: 0.08, probability: 0.8 },
          { word: " fox", start: 0.18, end: 0.32, probability: 0.95 },
          { word: ".", start: 0.32, end: 0.4, probability: 0.9 },
        ],
      }],
    })).toEqual({
      words: [
        { text: "the", start: 0.01, end: 0.08, confidence: 0.8 },
        { text: "fox", start: 0.18, end: 0.32, confidence: 0.95 },
      ],
    });
  });

  it("glues Whisper subword tokens into one manuscript word", () => {
    expect(normalizeServerResult({
      segments: [{
        words: [
          { word: " cart", start: 0.2, end: 0.35, probability: 0.96 },
          { word: "wheels", start: 0.35, end: 0.62, probability: 0.94 },
          { word: " over", start: 0.62, end: 0.8, probability: 0.99 },
        ],
      }],
    })).toEqual({
      words: [
        { text: "cartwheels", start: 0.2, end: 0.62, confidence: 0.94 },
        { text: "over", start: 0.62, end: 0.8, confidence: 0.99 },
      ],
    });
  });

  it("does not invent confidence when Whisper omitted it", () => {
    expect(normalizeServerResult({
      segments: [{
        words: [{ word: " the", start: 0.01, end: 0.08 }],
      }],
    })).toEqual({
      words: [{ text: "the", start: 0.01, end: 0.08, confidence: 0 }],
    });
  });

  it("keeps one model-loaded child for warm and transcription requests", async () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      child.exitCode = 0;
    };
    let starts = 0;
    const server = new PersistentWhisperServer({
      idleTimeoutMs: 60_000,
      portFinder: async () => 43210,
      spawnImpl: () => {
        starts += 1;
        return child;
      },
      randomId: () => "test-id",
      fetchImpl: async (_url, options = {}) => {
        if (!options.method) {
          return { ok: true, json: async () => ({ status: "ok" }) };
        }
        return {
          ok: true,
          json: async () => ({
            segments: [{ words: [{ word: "hello", start: 0, end: 0.4, probability: 0.9 }] }],
          }),
        };
      },
    });

    await expect(server.warm({ serverPath: "/server", modelPath: "/model" })).resolves.toEqual({
      persistent: true,
      acceleration: "Metal",
    });
    await expect(server.transcribe({
      serverPath: "/server",
      modelPath: "/model",
      wavBytes: Buffer.from("wav"),
    })).resolves.toMatchObject({ engine: "whisper.cpp server", words: [{ text: "hello" }] });
    expect(starts).toBe(1);
    server.stop();
    expect(child.killed).toBe(true);
  });
});
