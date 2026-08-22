const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_FEED_WAIT_MS = 1_500;
const START_SETTLE_MS = 120;
/**
 * The helper reads exactly this many floats per iteration (see
 * native/parakeet-live.c). Writing anything else leaves the remainder parked
 * inside its blocking read, unprocessed, until more audio happens to arrive —
 * so only ever hand it whole blocks and keep the remainder here.
 */
const HOP_SAMPLES = 2560;
/** Cap the request/response backlog; push subscribers drain nothing. */
const MAX_PENDING_LINES = 128;

class PersistentParakeetLive {
  constructor({ spawnImpl = spawn } = {}) {
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.buffer = "";
    this.pending = [];
    this.waiters = [];
    this.residual = new Float32Array(0);
    this.wordListeners = new Set();
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
    this.residual = new Float32Array(0);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      this.buffer += String(chunk);
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          this.pending.push(line);
          this.emitWords(parseLiveLine(line));
        }
        newline = this.buffer.indexOf("\n");
      }
      if (this.pending.length > MAX_PENDING_LINES) {
        this.pending.splice(0, this.pending.length - MAX_PENDING_LINES);
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

  /**
   * Subscribe to words as the helper finalizes them. Returns an unsubscribe.
   *
   * Prefer this over `feed` for live follow: `feed` resolves with whatever
   * lines happen to be queued, which is usually an earlier block's words
   * rather than the audio just written, so it reports the cursor one block
   * late no matter how fast the model runs.
   */
  onWords(listener) {
    this.wordListeners.add(listener);
    return () => {
      this.wordListeners.delete(listener);
    };
  }

  emitWords(words) {
    if (words.length === 0 || this.wordListeners.size === 0) {
      return;
    }
    for (const listener of this.wordListeners) {
      try {
        listener(words);
      } catch {
        // A failing subscriber must not stall audio ingest.
      }
    }
  }

  /**
   * Hand the helper 16 kHz mono float PCM without waiting for a result. Only
   * whole blocks are written; a short tail is held until the next call
   * completes it. Words surface through `onWords`.
   */
  write(pcm) {
    if (!this.running) {
      throw new Error("Parakeet live stream is not running.");
    }
    let merged = pcm;
    if (this.residual.length > 0) {
      merged = new Float32Array(this.residual.length + pcm.length);
      merged.set(this.residual, 0);
      merged.set(pcm, this.residual.length);
    }
    const blocks = Math.floor(merged.length / HOP_SAMPLES);
    const aligned = blocks * HOP_SAMPLES;
    if (blocks > 0) {
      const block = merged.subarray(0, aligned);
      this.child.stdin.write(Buffer.from(block.buffer, block.byteOffset, block.byteLength));
    }
    this.residual = merged.slice(aligned);
    return { blocks, buffered: this.residual.length };
  }

  async feed(pcm, { waitMs = DEFAULT_FEED_WAIT_MS } = {}) {
    if (!this.running) {
      throw new Error("Parakeet live stream is not running.");
    }
    this.write(pcm);
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
    this.residual = new Float32Array(0);
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
