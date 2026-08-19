const { EventEmitter } = require("node:events");
const { parseLiveLine, PersistentParakeetLive } = require("./parakeet-live.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.stdin = { write: () => true, end: () => undefined };
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => undefined;
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0);
  };
  return child;
}

describe("parakeet live JSON lines", () => {
  it("maps C-API hop words and ignores empty hops", () => {
    expect(parseLiveLine("{\"text\":\"\",\"words\":[]}")).toEqual([]);
    expect(parseLiveLine("{\"words\":[{\"w\":\"well\",\"start\":0.8,\"end\":0.88,\"conf\":0.95}]}")).toEqual([
      { text: "well", start: 0.8, end: 0.88, confidence: 0.95 },
    ]);
    expect(parseLiveLine("nope")).toEqual([]);
  });
});

describe("parakeet live process", () => {
  it("does not claim the stream is ready if the helper exits immediately", async () => {
    const child = fakeChild();
    const live = new PersistentParakeetLive({
      spawnImpl: () => {
        queueMicrotask(() => child.emit("exit", 1));
        return child;
      },
    });
    await expect(live.start({ serverPath: "/bin/parakeet-live", modelPath: "/models/x.gguf" })).rejects.toThrow(/not running|exited|failed/i);
    expect(live.running).toBe(false);
  });

  it("waits for a hop line instead of returning empty after 40ms", async () => {
    const child = fakeChild();
    const live = new PersistentParakeetLive({ spawnImpl: () => child });
    await live.start({ serverPath: "/bin/parakeet-live", modelPath: "/models/x.gguf" });
    const pcm = new Float32Array(2560);
    const pending = live.feed(pcm);
    setTimeout(() => {
      child.stdout.emit("data", "{\"words\":[{\"w\":\"well\",\"start\":0.8,\"end\":0.88,\"conf\":0.95}]}\n");
    }, 80);
    await expect(pending).resolves.toMatchObject({
      words: [{ text: "well", start: 0.8, end: 0.88, confidence: 0.95 }],
    });
  });
});
