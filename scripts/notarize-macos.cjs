const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 90 * 60 * 1_000;
const COMMAND_TIMEOUT_MS = 90_000;
const ACCEPTED = "Accepted";
const INVALID = new Set(["Invalid", "Rejected"]);

function appPathForContext(context) {
  if (context.electronPlatformName !== "darwin") {
    return null;
  }
  const productFilename = context.packager?.appInfo?.productFilename;
  if (!context.appOutDir || !productFilename) {
    throw new Error("macOS notarization did not receive the signed application path.");
  }
  return path.join(context.appOutDir, `${productFilename}.app`);
}

function credentialsFromEnv(env) {
  const required = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
  for (const name of required) {
    if (!env[name]) {
      throw new Error(`macOS notarization is missing ${name}.`);
    }
  }
  return ["--key", env.APPLE_API_KEY, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER];
}

function commandOutput(value) {
  return [value?.stdout, value?.stderr].filter(Boolean).join("\n").trim();
}

function isRetryableNetworkError(error) {
  const output = `${error?.message ?? ""}\n${commandOutput(error)}`;
  return /NSURLErrorDomain|No network route|internet connection appears to be offline|network connection was lost|network is unreachable|timed? out|Could not resolve host|statusCode: nil/i.test(output);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runDefault(command, args) {
  return execFileAsync(command, args, {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
  });
}

async function runJson(run, args) {
  const result = await run("xcrun", ["notarytool", ...args]);
  const output = String(result.stdout ?? "").trim();
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Apple notarization returned unreadable JSON: ${commandOutput(result) || "no output"}`);
  }
}

async function writeSummary(env, line) {
  if (!env.GITHUB_STEP_SUMMARY) {
    return;
  }
  await fs.appendFile(env.GITHUB_STEP_SUMMARY, `${line}\n`, "utf8");
}

async function getNotarizationLog(run, submissionId, credentials) {
  try {
    const result = await run("xcrun", ["notarytool", "log", submissionId, ...credentials]);
    return commandOutput(result);
  } catch (error) {
    return `Unable to fetch Apple's diagnostic log: ${commandOutput(error) || error.message}`;
  }
}

async function pollUntilComplete({ run, submissionId, credentials, logger, now = Date.now, sleepFor = sleep, pollIntervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS }) {
  const deadline = now() + timeoutMs;
  while (true) {
    let submission;
    try {
      submission = await runJson(run, ["info", submissionId, ...credentials, "--output-format", "json"]);
    } catch (error) {
      if (!isRetryableNetworkError(error) || now() >= deadline) {
        throw error;
      }
      logger(`[notarization] status check for ${submissionId} hit a temporary network error; retrying in ${Math.ceil(pollIntervalMs / 1_000)}s.`);
      await sleepFor(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
      continue;
    }

    const status = String(submission.status ?? "Unknown");
    logger(`[notarization] submission ${submissionId}: ${status}`);
    if (status === ACCEPTED) {
      return submission;
    }
    if (INVALID.has(status)) {
      const diagnosticLog = await getNotarizationLog(run, submissionId, credentials);
      throw new Error(`Apple rejected notarization submission ${submissionId}.\n${diagnosticLog}`);
    }
    if (now() >= deadline) {
      throw new Error(`Apple did not finish notarization submission ${submissionId} within ${Math.round(timeoutMs / 60_000)} minutes.`);
    }
    await sleepFor(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}

async function stapleWithRetry({ run, appPath, logger, sleepFor = sleep }) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await run("xcrun", ["stapler", "staple", appPath]);
      logger("[notarization] stapled Apple's ticket to the app bundle.");
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 4) {
        break;
      }
      logger(`[notarization] stapling is not ready yet; retrying (${attempt}/4).`);
      await sleepFor(attempt * 15_000);
    }
  }
  throw lastError;
}

async function notarizeMacApp(context, dependencies = {}) {
  const appPath = appPathForContext(context);
  if (!appPath) {
    return;
  }

  const env = dependencies.env ?? process.env;
  const run = dependencies.run ?? runDefault;
  const logger = dependencies.logger ?? ((line) => process.stdout.write(`${line}\n`));
  const sleepFor = dependencies.sleepFor ?? sleep;
  const credentials = credentialsFromEnv(env);
  await fs.access(appPath);
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-notarize-"));
  const archivePath = path.join(tempDirectory, `${path.basename(appPath, ".app")}.zip`);

  try {
    logger("[notarization] creating an upload archive from the signed app.");
    await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath]);
    const submission = await runJson(run, ["submit", archivePath, ...credentials, "--output-format", "json"]);
    const submissionId = typeof submission.id === "string" ? submission.id : "";
    if (!submissionId) {
      throw new Error("Apple did not return a notarization submission ID.");
    }

    logger(`[notarization] submitted to Apple: ${submissionId}`);
    await writeSummary(env, `macOS notarization submission: ${submissionId}`);
    await pollUntilComplete({
      run,
      submissionId,
      credentials,
      logger,
      sleepFor,
      pollIntervalMs: dependencies.pollIntervalMs ?? POLL_INTERVAL_MS,
      timeoutMs: dependencies.timeoutMs ?? POLL_TIMEOUT_MS,
      now: dependencies.now ?? Date.now,
    });
    await stapleWithRetry({ run, appPath, logger, sleepFor });
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

module.exports = notarizeMacApp;
module.exports.appPathForContext = appPathForContext;
module.exports.isRetryableNetworkError = isRetryableNetworkError;
module.exports.notarizeMacApp = notarizeMacApp;
module.exports.pollUntilComplete = pollUntilComplete;
