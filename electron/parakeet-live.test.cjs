const { EventEmitter } = require("node:events");
const { parseLiveLine, PersistentParakeetLive } = require("./parakeet-live.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.writes = [];
  child.stdin = {
    write: (bytes) => {
      child.writes.push(bytes.length / 4);
      return true;
    },
    end: () => undefined,
  };
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

describe("parakeet live block alignment", () => {
  async function started() {
    const child = fakeChild();
    const live = new PersistentParakeetLive({ spawnImpl: () => child });
    await live.start({ serverPath: "/bin/parakeet-live", modelPath: "/models/x.gguf" });
    return { child, live };
  }

  it("only writes whole 2560-sample blocks so the helper never holds a partial one", async () => {
    const { child, live } = await started();
    // A window sized like the renderer's accumulation: 0.171 s at 16 kHz.
    expect(live.write(new Float32Array(2736))).toEqual({ blocks: 1, buffered: 176 });
    expect(child.writes).toEqual([2560]);
  });

  it("completes a held tail from the following window instead of stranding it", async () => {
    const { child, live } = await started();
    live.write(new Float32Array(1500));
    expect(child.writes).toEqual([]);
    live.write(new Float32Array(1060));
    expect(child.writes).toEqual([2560]);
    expect(live.residual.length).toBe(0);
  });

  it("writes every whole block when a window spans several", async () => {
    const { child, live } = await started();
    expect(live.write(new Float32Array(2560 * 3 + 40))).toEqual({ blocks: 3, buffered: 40 });
    expect(child.writes).toEqual([2560 * 3]);
  });

  it("pushes words to subscribers as the helper emits them", async () => {
    const { child, live } = await started();
    const seen = [];
    const stop = live.onWords((words) => seen.push(...words));
    child.stdout.emit("data", "{\"words\":[{\"w\":\"crossed\",\"start\":1.1,\"end\":1.3,\"conf\":0.9}]}\n");
    expect(seen).toEqual([{ text: "crossed", start: 1.1, end: 1.3, confidence: 0.9 }]);
    stop();
    child.stdout.emit("data", "{\"words\":[{\"w\":\"channel\",\"start\":1.4,\"end\":1.6,\"conf\":0.9}]}\n");
    expect(seen).toHaveLength(1);
  });

  it("does not grow the reply backlog without bound when nobody reads it", async () => {
    const { child, live } = await started();
    live.onWords(() => undefined);
    for (let index = 0; index < 400; index += 1) {
      child.stdout.emit("data", "{\"text\":\"\",\"words\":[]}\n");
    }
    expect(live.pending.length).toBeLessThanOrEqual(128);
  });

  it("drops a held tail when the stream stops", async () => {
    const { live } = await started();
    live.write(new Float32Array(100));
    expect(live.residual.length).toBe(100);
    live.stop();
    expect(live.residual.length).toBe(0);
  });
});
