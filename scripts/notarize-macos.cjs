const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { verifyPackagedAppUpdateConfig } = require("./ensure-app-update-config.cjs");

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const STATE_FILE_NAME = "submission.json";
const ARCHIVE_FILE_NAME = "Kosmos-signed-app.zip";

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

function stagingDirectoryForContext(context) {
  if (!context.appOutDir) {
    throw new Error("macOS notarization did not receive an output directory.");
  }
  return path.join(path.dirname(context.appOutDir), "notarization");
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

async function writeSummary(env, lines) {
  if (!env.GITHUB_STEP_SUMMARY) {
    return;
  }
  await fs.appendFile(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

function submissionState({ context, env, submissionId, appPath, archivePath, createdAt }) {
  return {
    schemaVersion: 1,
    submissionId,
    status: "In Progress",
    appName: path.basename(appPath),
    appArchive: path.basename(archivePath),
    version: context.packager?.appInfo?.version ?? "",
    sourceSha: env.GITHUB_SHA ?? "",
    sourceRef: env.GITHUB_REF ?? "",
    sourceRefName: env.GITHUB_REF_NAME ?? "",
    sourceRunId: env.GITHUB_RUN_ID ?? "",
    createdAt,
  };
}

async function submitMacApp(context, dependencies = {}) {
  const appPath = appPathForContext(context);
  if (!appPath) {
    return null;
  }

  const env = dependencies.env ?? process.env;
  const run = dependencies.run ?? runDefault;
  const logger = dependencies.logger ?? ((line) => process.stdout.write(`${line}\n`));
  const createdAt = dependencies.createdAt ?? (() => new Date().toISOString());
  const credentials = credentialsFromEnv(env);
  const stagingDirectory = stagingDirectoryForContext(context);
  const archivePath = path.join(stagingDirectory, ARCHIVE_FILE_NAME);
  const statePath = path.join(stagingDirectory, STATE_FILE_NAME);

  await fs.access(appPath);
  await verifyPackagedAppUpdateConfig({ platform: "darwin", appPath });
  await fs.mkdir(stagingDirectory, { recursive: true });
  await Promise.all([
    fs.rm(archivePath, { force: true }),
    fs.rm(statePath, { force: true }),
  ]);

  logger("[notarization] preserving the exact signed app for asynchronous notarization.");
  await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath]);
  const submission = await runJson(run, ["submit", archivePath, ...credentials, "--output-format", "json"]);
  const submissionId = typeof submission.id === "string" ? submission.id : "";
  if (!submissionId) {
    throw new Error("Apple did not return a notarization submission ID.");
  }

  const state = submissionState({
    context,
    env,
    submissionId,
    appPath,
    archivePath,
    createdAt: createdAt(),
  });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  logger(`[notarization] submitted to Apple once: ${submissionId}`);
  logger(`[notarization] saved the signed app and submission state at ${stagingDirectory}.`);
  await writeSummary(env, [
    `macOS notarization submission: ${submissionId}`,
    "The signed app was preserved so a later job can wait, staple, and package it without rebuilding or resubmitting.",
  ]);
  return state;
}

module.exports = submitMacApp;
module.exports.ARCHIVE_FILE_NAME = ARCHIVE_FILE_NAME;
module.exports.STATE_FILE_NAME = STATE_FILE_NAME;
module.exports.appPathForContext = appPathForContext;
module.exports.stagingDirectoryForContext = stagingDirectoryForContext;
module.exports.submissionState = submissionState;
module.exports.submitMacApp = submitMacApp;
