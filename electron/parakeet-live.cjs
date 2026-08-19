const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_FEED_WAIT_MS = 1_500;
const START_SETTLE_MS = 120;

class PersistentParakeetLive {
  constructor({ spawnImpl = spawn } = {}) {
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.buffer = "";
    this.pending = [];
    this.waiters = [];
  }

  get running() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode == null);
  }

  async start({ serverPath, modelPath }) {
    if (this.running) {
      return { persistent: true, acceleration: "Metal", engine: "parakeet-live", streaming: true };
    }
    const child = this.spawnImpl(serverPath, [modelPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(serverPath),
      env: {
        ...process.env,
        DYLD_LIBRARY_PATH: path.dirname(serverPath),
      },
    });
    this.child = child;
    this.buffer = "";
    this.pending = [];
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      this.buffer += String(chunk);
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          this.pending.push(line);
        }
        newline = this.buffer.indexOf("\n");
      }
      this.flushWaiters();
    });
    child.once("error", () => {
      if (this.child === child) {
        this.child = null;
      }
      this.flushWaiters();
    });
    child.once("exit", () => {
      if (this.child === child) {
        this.child = null;
      }
      this.flushWaiters();
    });
    await waitFor(START_SETTLE_MS, () => !this.running);
    if (!this.running) {
      throw new Error("Parakeet live stream failed to start.");
    }
    return { persistent: true, acceleration: "Metal", engine: "parakeet-live", streaming: true };
  }

  async feed(pcm, { waitMs = DEFAULT_FEED_WAIT_MS } = {}) {
    if (!this.running) {
      throw new Error("Parakeet live stream is not running.");
    }
    const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    this.child.stdin.write(bytes);
    if (this.pending.length === 0) {
      await waitFor(waitMs, () => this.pending.length > 0 || !this.running);
    }
    if (!this.running && this.pending.length === 0) {
      throw new Error("Parakeet live stream is not running.");
    }
    const lines = this.pending.splice(0, this.pending.length);
    return { engine: "parakeet-live", streaming: true, words: lines.flatMap(parseLiveLine) };
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.buffer = "";
    this.pending = [];
    if (child && !child.killed) {
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      child.kill();
    }
  }

  flushWaiters() {
    const waiters = this.waiters.splice(0, this.waiters.length);
    for (const resolve of waiters) {
      resolve();
    }
  }
}

function parseLiveLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (!Array.isArray(parsed.words)) {
      return [];
    }
    return parsed.words.flatMap((item) => {
      const text = String(item?.w ?? item?.word ?? "").replace(/<EOU>|<EOB>/giu, "").trim();
      const start = Number(item?.start);
      const end = Number(item?.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return [];
      }
      const confidence = Number(item?.conf);
      return [{
        text,
        start,
        end,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.75,
      }];
    });
  } catch {
    return [];
  }
}

function waitFor(ms, done) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (done() || Date.now() - started >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

module.exports = { PersistentParakeetLive, parseLiveLine };
