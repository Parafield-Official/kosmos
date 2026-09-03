const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { terminateChild } = require("./process.cjs");
const { defaultLiveGpu, liveAccelerationLabel } = require("./runtime.cjs");

const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
const STARTUP_TIMEOUT_MS = 45_000;
const HEALTH_POLL_MS = 100;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A small loopback-only whisper.cpp server client. The server keeps the model
 * resident between live windows, avoiding a 487 MB model reload for every
 * microphone request. It is deliberately scoped to listen-only narration;
 * full-chapter Proof continues to use the CLI's higher-quality path.
 */
class PersistentWhisperServer {
  constructor({
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    spawnImpl = spawn,
    fetchImpl = globalThis.fetch,
    portFinder = findFreePort,
    randomId = () => crypto.randomUUID(),
    now = () => Date.now(),
    platform = process.platform,
    useGpu,
  } = {}) {
    this.idleTimeoutMs = idleTimeoutMs;
    this.spawnImpl = spawnImpl;
    this.fetchImpl = fetchImpl;
    this.portFinder = portFinder;
    this.randomId = randomId;
    this.now = now;
    this.platform = platform;
    this.child = null;
    this.port = null;
    this.requestPath = null;
    this.modelPath = null;
    this.serverPath = null;
    this.readyPromise = null;
    this.idleTimer = null;
    this.lastUsedAt = 0;
    this.useGpu = useGpu ?? defaultLiveGpu(platform);
    this.stderr = "";
    this.requestControllers = new Set();
  }

  async warm({ serverPath, modelPath, threads }) {
    await this.ensureStarted({ serverPath, modelPath, threads });
    this.scheduleIdleShutdown();
    return { persistent: true, acceleration: liveAccelerationLabel(this.useGpu, this.platform) };
  }

  async transcribe({ serverPath, modelPath, wavBytes, language = "en", threads }) {
    if (!Buffer.isBuffer(wavBytes) || wavBytes.length === 0) {
      throw new Error("The live audio window is empty.");
    }
    await this.ensureStarted({ serverPath, modelPath, threads });
    try {
      const result = await this.request({ wavBytes, language });
      this.lastUsedAt = this.now();
      this.scheduleIdleShutdown();
      return {
        ...normalizeServerResult(result),
        engine: "whisper.cpp server",
        modelPath,
        acceleration: liveAccelerationLabel(this.useGpu, this.platform),
      };
    } catch (error) {
      // GPU/Metal can be unavailable even when the server itself starts.
      // Retry the same request once with CPU before the caller falls back
      // to the one-shot whisper-cli path.
      if (this.useGpu && this.child) {
        this.stop();
        this.useGpu = false;
        await this.ensureStarted({ serverPath, modelPath, threads });
        try {
          const result = await this.request({ wavBytes, language });
          this.lastUsedAt = this.now();
          this.scheduleIdleShutdown();
          return {
            ...normalizeServerResult(result),
            engine: "whisper.cpp server",
            modelPath,
            acceleration: "CPU",
          };
        } catch (fallbackError) {
          this.lastUsedAt = this.now();
          this.scheduleIdleShutdown();
          throw fallbackError;
        }
      }
      this.lastUsedAt = this.now();
      this.scheduleIdleShutdown();
      throw error;
    }
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
    this.requestPath = null;
    this.modelPath = null;
    this.serverPath = null;
    this.stderr = "";
    for (const controller of this.requestControllers) {
      controller.abort();
    }
    this.requestControllers.clear();
    terminateChild(child, { force });
  }

  async ensureStarted({ serverPath, modelPath, threads }) {
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
    const readyPromise = this.start({ serverPath, modelPath, threads })
      .catch(async (error) => {
        this.stop();
        if (this.useGpu) {
          this.useGpu = false;
          this.serverPath = serverPath;
          this.modelPath = modelPath;
          await this.start({ serverPath, modelPath, threads });
          return;
        }
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
      && this.requestPath
      && this.modelPath === modelPath
      && this.serverPath === serverPath
    );
  }

  async start({ serverPath, modelPath, threads }) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("The desktop runtime does not provide local HTTP requests.");
    }
    const port = await this.portFinder();
    const requestPath = `/kosmos-live-${this.randomId().replace(/[^a-z0-9]/giu, "")}`;
    const args = buildWhisperServerArgs({
      serverPath,
      modelPath,
      port,
      requestPath,
      threads,
      useGpu: this.useGpu,
    });
    const child = this.spawnImpl(serverPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.port = port;
    this.requestPath = requestPath;
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
        this.requestPath = null;
      }
    });

    const deadline = this.now() + STARTUP_TIMEOUT_MS;
    while (this.now() < deadline) {
      if (this.child !== child) {
        throw new Error("Whisper server was stopped before it was ready.");
      }
      if (exited || child.exitCode !== null || child.signalCode != null) {
        throw new Error(`Whisper server exited before it was ready${this.stderr ? `: ${this.stderr.trim()}` : "."}`);
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
        // The model may still be loading, or the listener may not be bound.
      }
      await delay(HEALTH_POLL_MS);
    }
    throw new Error("Whisper server did not become ready in time.");
  }

  async request({ wavBytes, language }) {
    const controller = new AbortController();
    this.requestControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "window.wav");
      form.append("response_format", "verbose_json");
      form.append("language", normalizeLanguage(language));
      form.append("token_timestamps", "true");
      form.append("no_language_probabilities", "true");
      form.append("temperature", "0");
      form.append("temperature_inc", "0");
      form.append("suppress_nst", "true");
      const response = await this.fetchImpl(this.url("/inference"), {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Whisper server returned HTTP ${response.status}.`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      this.requestControllers.delete(controller);
    }
  }

  url(pathname) {
    return `http://127.0.0.1:${this.port}${this.requestPath}${pathname}`;
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

function buildWhisperServerArgs({ serverPath, modelPath, port, requestPath, threads, useGpu = true }) {
  const args = [
    "-m", modelPath,
    "-t", String(Number.isFinite(threads) && threads > 0 ? Math.floor(threads) : 4),
    "-bo", "5",
    "-bs", "5",
    "-sow",
    "-sns",
    "--host", "127.0.0.1",
    "--port", String(port),
    "--request-path", requestPath,
  ];
  if (!useGpu) {
    args.push("-ng");
  }
  return args;
}

function normalizeServerResult(result) {
  if (!result || !Array.isArray(result.segments)) {
    throw new Error("Whisper server did not return a segments array.");
  }
  const words = [];
  for (const segment of result.segments) {
    if (!Array.isArray(segment?.words)) {
      continue;
    }
    for (const item of segment.words) {
      const raw = String(item?.word ?? "");
      const startsWord = words.length === 0 || /^\s/u.test(raw);
      const matches = raw.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
      const start = Number(item?.start);
      const end = Number(item?.end);
      if (matches.length === 0 || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        continue;
      }
      const confidence = Number.isFinite(Number(item?.probability))
        ? Math.max(0, Math.min(1, Number(item.probability)))
        : 0;
      for (const text of matches) {
        const previous = words.at(-1);
        if (!startsWord && previous) {
          previous.text += text;
          previous.end = Math.max(previous.end, end);
          previous.confidence = Math.min(previous.confidence, confidence);
          continue;
        }
        words.push({ text, start, end, confidence });
      }
    }
  }
  return { words };
}

function normalizeLanguage(language) {
  return typeof language === "string" && /^[a-z]{2,8}(?:-[a-z]{2,8})?$/iu.test(language.trim())
    ? language.trim()
    : "en";
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
          reject(new Error("Could not reserve a local Whisper server port."));
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
  PersistentWhisperServer,
  buildWhisperServerArgs,
  findFreePort,
  normalizeServerResult,
};
