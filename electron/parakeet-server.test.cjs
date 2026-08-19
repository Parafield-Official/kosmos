const { EventEmitter } = require("node:events");
const {
  PersistentParakeetServer,
  buildParakeetServerArgs,
  normalizeParakeetResult,
} = require("./parakeet-server.cjs");

describe("persistent Parakeet live server", () => {
  it("binds only to loopback", () => {
    expect(buildParakeetServerArgs({
      modelPath: "/models/realtime_eou_120m-v1-f16.gguf",
      port: 8765,
    })).toEqual([
      "--model", "/models/realtime_eou_120m-v1-f16.gguf",
      "--host", "127.0.0.1",
      "--port", "8765",
    ]);
  });

  it("maps verbose JSON word times and strips end-of-utterance marks", () => {
    expect(normalizeParakeetResult({
      text: "the fox jumped",
      words: [
        { word: "the", start: 0.1, end: 0.2, conf: 0.9 },
        { word: "fox", start: 0.3, end: 0.45, conf: 0.95 },
        { word: "jumped<EOU>", start: 0.5, end: 0.8, conf: 0.88 },
      ],
    })).toEqual({
      words: [
        { text: "the", start: 0.1, end: 0.2, confidence: 0.9 },
        { text: "fox", start: 0.3, end: 0.45, confidence: 0.95 },
        { text: "jumped", start: 0.5, end: 0.8, confidence: 0.88 },
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
    const server = new PersistentParakeetServer({
      idleTimeoutMs: 60_000,
      portFinder: async () => 8765,
      spawnImpl: () => {
        starts += 1;
        return child;
      },
      fetchImpl: async (_url, options = {}) => {
        if (!options.method) {
          return { ok: true, json: async () => ({ status: "ok" }) };
        }
        return {
          ok: true,
          json: async () => ({
            words: [{ word: "hello", start: 0, end: 0.4, conf: 0.9 }],
          }),
        };
      },
    });
    await server.warm({
      serverPath: "/tmp/parakeet-server",
      modelPath: "/models/realtime_eou_120m-v1-f16.gguf",
    });
    const first = await server.transcribe({
      serverPath: "/tmp/parakeet-server",
      modelPath: "/models/realtime_eou_120m-v1-f16.gguf",
      wavBytes: Buffer.from("RIFF"),
    });
    const second = await server.transcribe({
      serverPath: "/tmp/parakeet-server",
      modelPath: "/models/realtime_eou_120m-v1-f16.gguf",
      wavBytes: Buffer.from("RIFF"),
    });
    expect(starts).toBe(1);
    expect(first.engine).toBe("parakeet.cpp server");
    expect(second.words).toEqual([{ text: "hello", start: 0, end: 0.4, confidence: 0.9 }]);
    server.stop();
  });
});
