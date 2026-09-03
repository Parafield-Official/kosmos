const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINATION_GRACE_MS = 1000;
const activeChildren = new Set();

function childIsRunning(child) {
  return Boolean(child && child.exitCode == null && child.signalCode == null);
}

/**
 * Stop a native helper and escalate if it ignores SIGTERM. `child.killed` only
 * means Node managed to send a signal; it does not mean the process exited.
 */
function terminateChild(child, { force = false, graceMs = TERMINATION_GRACE_MS } = {}) {
  if (!childIsRunning(child)) {
    return;
  }
  try {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch {
    return;
  }
  if (force) {
    return;
  }
  const timer = setTimeout(() => {
    if (childIsRunning(child)) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may have exited between the state check and the signal.
      }
    }
  }, graceMs);
  timer.unref?.();
  child.once?.("exit", () => clearTimeout(timer));
}

/** Stop all one-shot ffmpeg/Whisper/WhisperX helpers during application exit. */
function terminateActiveCommands({ force = false } = {}) {
  for (const child of activeChildren) {
    terminateChild(child, { force });
  }
}

function activeCommandCount() {
  return activeChildren.size;
}

/** Run a local helper without allowing a wedged decoder to hang the app. */
function runCommand(command, args = [], options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = Number.isFinite(options.maxOutputBytes) && options.maxOutputBytes > 0
    ? options.maxOutputBytes
    : Infinity;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let outputTooLarge = false;
    let timeoutTimer;
    const stdout = [];
    const stderr = [];
    let collectedBytes = 0;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    activeChildren.add(child);

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      activeChildren.delete(child);
      clearTimeout(timeoutTimer);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);

    const collect = (target, chunk) => {
      if (outputTooLarge) {
        return;
      }
      if (collectedBytes + chunk.length > maxOutputBytes) {
        outputTooLarge = true;
        terminateChild(child);
        return;
      }
      collectedBytes += chunk.length;
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (timedOut) {
        finish(new Error(`${command} timed out after ${timeoutMs} ms`));
        return;
      }
      if (outputTooLarge) {
        finish(new Error(`${command} output exceeded the ${maxOutputBytes} byte limit`));
        return;
      }
      if (code === 0) {
        finish(null, Buffer.concat(stdout));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      finish(new Error(
        `${command} exited ${code ?? "unknown"}${signal ? ` (${signal})` : ""}${detail ? `: ${detail}` : ""}`,
      ));
    });
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  TERMINATION_GRACE_MS,
  activeCommandCount,
  runCommand,
  terminateActiveCommands,
  terminateChild,
};
