const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

/**
 * Local-only Whisper boundary. The desktop shell can ship whisper-cli and a
 * model under resources/, while contributors can point the same code at a
 * locally built binary with WHISPER_CLI_PATH and WHISPER_MODEL_PATH.
 */
async function transcribeAudio({ audioPath, userDataPath, resourcesPath, appPath, language = "en" }) {
  const cliPath = findWhisperCli({ resourcesPath, appPath });
  if (!cliPath) {
    throw new Error(
      "Local Whisper is not installed yet. Add whisper-cli to the Booth Desk bundle, or set WHISPER_CLI_PATH for a development build.",
    );
  }

  const modelPath = await findModel({ userDataPath, resourcesPath, appPath });
  if (!modelPath) {
    throw new Error(
      "No local Whisper model is available. Download the signed model from Booth Desk's Proof screen; it stays on this computer.",
    );
  }

  const outputPath = `${audioPath}.json`;
  try {
    await run(cliPath, [
      "-m", modelPath,
      "-f", audioPath,
      "-l", language,
      "-oj",
      "-np",
    ], { cwd: path.dirname(audioPath) });
    const json = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return {
      engine: "whisper.cpp",
      modelPath,
      words: segmentWords(json.transcription ?? []),
    };
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

function findWhisperCli({ resourcesPath, appPath }) {
  const candidates = [
    process.env.WHISPER_CLI_PATH,
    resourcesPath && path.join(resourcesPath, "whisper-cli"),
    resourcesPath && path.join(resourcesPath, "bin", "whisper-cli"),
    appPath && path.join(appPath, "vendor", "whisper-cli"),
    process.cwd() && path.join(process.cwd(), "vendor", "whisper-cli"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (result.status === 0) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, ["whisper-cli"], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

async function findModel({ userDataPath, resourcesPath, appPath }) {
  const candidates = [
    process.env.WHISPER_MODEL_PATH,
    userDataPath && path.join(userDataPath, "models", "ggml-small.en.bin"),
    userDataPath && path.join(userDataPath, "models", "ggml-tiny.en.bin"),
    resourcesPath && path.join(resourcesPath, "models", "ggml-small.en.bin"),
    appPath && path.join(appPath, "models", "ggml-small.en.bin"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next local cache location.
    }
  }
  return null;
}

function segmentWords(segments) {
  const words = [];
  for (const segment of segments) {
    const text = String(segment.text ?? "").trim();
    const tokens = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
    if (tokens.length === 0) {
      continue;
    }
    const start = parseWhisperTime(segment.offsets?.from, segment.timestamps?.from);
    const end = parseWhisperTime(segment.offsets?.to, segment.timestamps?.to);
    const duration = Math.max(0, end - start);
    const weights = tokens.map((token) => Math.max(1, token.length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = start;
    tokens.forEach((token, index) => {
      const wordDuration = duration > 0 ? duration * (weights[index] / totalWeight) : 0;
      words.push({
        text: token,
        start: cursor,
        end: Math.max(cursor, cursor + wordDuration),
        confidence: 0.75,
      });
      cursor += wordDuration;
    });
  }
  return words;
}

function parseWhisperTime(offsetMs, timestamp) {
  if (Number.isFinite(Number(offsetMs))) {
    return Number(offsetMs) / 1000;
  }
  const value = String(timestamp ?? "");
  const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`whisper-cli exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
      }
    });
  });
}

module.exports = { transcribeAudio, segmentWords };

