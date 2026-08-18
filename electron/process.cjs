const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

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
    let killTimer = null;
    let timeoutTimer;
    const stdout = [];
    const stderr = [];
    let collectedBytes = 0;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);

    const collect = (target, chunk) => {
      if (outputTooLarge) {
        return;
      }
      if (collectedBytes + chunk.length > maxOutputBytes) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
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

module.exports = { DEFAULT_TIMEOUT_MS, runCommand };
