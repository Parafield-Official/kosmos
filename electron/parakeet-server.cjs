const net = require("node:net");
const { spawn } = require("node:child_process");
const { terminateChild } = require("./process.cjs");
const { liveAccelerationLabel } = require("./runtime.cjs");

const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
const STARTUP_TIMEOUT_MS = 45_000;
const HEALTH_POLL_MS = 100;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Loopback-only parakeet.cpp server. Keeps the 120M live-follow model hot
 * between microphone windows. Proof still uses whisper-cli.
 */
class PersistentParakeetServer {
  constructor({
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    spawnImpl = spawn,
    fetchImpl = globalThis.fetch,
    portFinder = findFreePort,
    now = () => Date.now(),
  } = {}) {
    this.idleTimeoutMs = idleTimeoutMs;
    this.spawnImpl = spawnImpl;
    this.fetchImpl = fetchImpl;
    this.portFinder = portFinder;
    this.now = now;
    this.child = null;
    this.port = null;
    this.modelPath = null;
    this.serverPath = null;
    this.readyPromise = null;
    this.idleTimer = null;
    this.lastUsedAt = 0;
    this.stderr = "";
    this.requestControllers = new Set();
  }

  async warm({ serverPath, modelPath }) {
    await this.ensureStarted({ serverPath, modelPath });
    this.scheduleIdleShutdown();
    return { persistent: true, acceleration: liveAccelerationLabel(true), engine: "parakeet.cpp server" };
  }

  async transcribe({ serverPath, modelPath, wavBytes }) {
    if (!Buffer.isBuffer(wavBytes) || wavBytes.length === 0) {
      throw new Error("The live audio window is empty.");
    }
    await this.ensureStarted({ serverPath, modelPath });
    const result = await this.request({ wavBytes });
    this.lastUsedAt = this.now();
    this.scheduleIdleShutdown();
    return {
      ...normalizeParakeetResult(result),
      engine: "parakeet.cpp server",
      modelPath,
      acceleration: liveAccelerationLabel(true),
    };
  }

  stop({ force = false } = {}) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.readyPromise = null;
    const child = this.child;
    this.child = null;
    this.port = null;
    this.modelPath = null;
    this.serverPath = null;
    this.stderr = "";
    for (const controller of this.requestControllers) {
      controller.abort();
    }
    this.requestControllers.clear();
    terminateChild(child, { force });
  }

  async ensureStarted({ serverPath, modelPath }) {
    if (this.isStartedFor({ serverPath, modelPath })) {
      return;
    }
    if (this.readyPromise) {
      await this.readyPromise;
      if (this.isStartedFor({ serverPath, modelPath })) {
        return;
      }
    }
    if (this.child) {
      this.stop();
    }
    this.serverPath = serverPath;
    this.modelPath = modelPath;
    const readyPromise = this.start({ serverPath, modelPath }).catch((error) => {
      this.stop();
      throw error;
    });
    this.readyPromise = readyPromise;
    try {
      await readyPromise;
    } finally {
      if (this.readyPromise === readyPromise) {
        this.readyPromise = null;
      }
    }
  }

  isStartedFor({ serverPath, modelPath }) {
    return Boolean(
      this.child
      && this.child.exitCode == null
      && this.child.signalCode == null
      && this.port
      && this.modelPath === modelPath
      && this.serverPath === serverPath
    );
  }

  async start({ serverPath, modelPath }) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("The desktop runtime does not provide local HTTP requests.");
    }
    const port = await this.portFinder();
    const args = buildParakeetServerArgs({ modelPath, port });
    const child = this.spawnImpl(serverPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.port = port;
    this.stderr = "";
    child.stderr?.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4_000);
    });
    let exited = false;
    child.once("exit", () => {
      exited = true;
      if (this.child === child) {
        this.child = null;
        this.port = null;
      }
    });

    const deadline = this.now() + STARTUP_TIMEOUT_MS;
    while (this.now() < deadline) {
      if (this.child !== child) {
        throw new Error("Parakeet server was stopped before it was ready.");
      }
      if (exited || child.exitCode !== null || child.signalCode != null) {
        throw new Error(`Parakeet server exited before it was ready${this.stderr ? `: ${this.stderr.trim()}` : "."}`);
      }
      try {
        const response = await this.fetchImpl(this.url("/health"));
        if (response.ok) {
          const body = await response.json();
          if (body?.status === "ok") {
            this.lastUsedAt = this.now();
            return;
          }
        }
      } catch {
        // Still loading.
      }
      await delay(HEALTH_POLL_MS);
    }
    throw new Error("Parakeet server did not become ready in time.");
  }

  async request({ wavBytes }) {
    const controller = new AbortController();
    this.requestControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "window.wav");
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      const response = await this.fetchImpl(this.url("/v1/audio/transcriptions"), {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Parakeet server returned HTTP ${response.status}.`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      this.requestControllers.delete(controller);
    }
  }

  url(pathname) {
    return `http://127.0.0.1:${this.port}${pathname}`;
  }

  scheduleIdleShutdown() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      if (this.now() - this.lastUsedAt >= this.idleTimeoutMs) {
        this.stop();
      } else {
        this.scheduleIdleShutdown();
      }
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }
}

function buildParakeetServerArgs({ modelPath, port }) {
  return [
    "--model", modelPath,
    "--host", "127.0.0.1",
    "--port", String(port),
  ];
}

function normalizeParakeetResult(result) {
  const rawWords = Array.isArray(result?.words)
    ? result.words
    : Array.isArray(result?.segments)
      ? result.segments.flatMap((segment) => segment?.words ?? [])
      : null;
  if (!rawWords) {
    throw new Error("Parakeet server did not return a words array.");
  }
  const words = [];
  for (const item of rawWords) {
    const cleaned = String(item?.word ?? item?.text ?? "")
      .replace(/<EOU>/giu, "")
      .replace(/<EOB>/giu, "");
    const matches = cleaned.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (matches.length === 0 || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      continue;
    }
    const confidence = Number(item?.conf ?? item?.probability);
    for (const text of matches) {
      words.push({
        text,
        start,
        end,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.75,
      });
    }
  }
  return { words };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
        } else if (!port) {
          reject(new Error("Could not reserve a local Parakeet server port."));
        } else {
          resolve(port);
        }
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_MS,
  PersistentParakeetServer,
  buildParakeetServerArgs,
  normalizeParakeetResult,
};
