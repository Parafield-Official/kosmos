const { EventEmitter } = require("node:events");
const {
  PersistentWhisperServer,
  buildWhisperServerArgs,
  normalizeServerResult,
} = require("./asr-server.cjs");

describe("persistent Whisper server adapter", () => {
  it("binds only to loopback and uses greedy live decoding", () => {
    expect(buildWhisperServerArgs({
      serverPath: "/vendor/bin/whisper-server",
      modelPath: "/models/small.en.bin",
      port: 43210,
      requestPath: "/kosmos-live-test",
      threads: 6,
    })).toEqual([
      "-m", "/models/small.en.bin",
      "-t", "6",
      "-bo", "1",
      "-bs", "1",
      "-sow",
      "-sns",
      "-ac", "768",
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
