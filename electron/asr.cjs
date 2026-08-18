const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { runCommand } = require("./process.cjs");
const { resolveRuntimeBinary } = require("./runtime.cjs");
const { modelStatus, modelStatusForFile } = require("./model.cjs");

const FFMPEG_CONVERSION_TIMEOUT_MS = 30 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/**
 * Local-only Whisper boundary. The desktop shell can ship whisper-cli and a
 * model under resources/, while contributors can point the same code at a
 * locally built binary with WHISPER_CLI_PATH and WHISPER_MODEL_PATH.
 */
async function transcribeAudio({ audioPath, userDataPath, resourcesPath, appPath, language = "en", requireBundled = false }) {
  const cliPath = findWhisperCli({ resourcesPath, appPath, requireBundled });
  if (!cliPath) {
    throw new Error(
      "Speech checking is not ready yet. Reinstall Booth Desk or choose a transcript on the chapter screen.",
    );
  }

  const modelPath = await findModel({ userDataPath, resourcesPath, appPath });
  if (!modelPath) {
    throw new Error(
      "No speech model is ready yet. Download it from the chapter screen to continue.",
    );
  }

  // whisper.cpp builds do not consistently decode MP3/FLAC/M4A/AIFF. Convert
  // every accepted source to an isolated PCM16 WAV first; the unique folder
  // also prevents simultaneous Proof runs from fighting over `<audio>.json`.
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "booth-asr-"));
  const convertedPath = path.join(temporaryRoot, "input.wav");
  const outputBase = path.join(temporaryRoot, "transcript");
  const outputPath = `${outputBase}.json`;
  try {
    const ffmpegPath = resolveRuntimeBinary({
      name: "ffmpeg",
      envVar: "FFMPEG_PATH",
      resourcesPath,
      appPath,
      requireBundled,
    });
    await run(ffmpegPath, buildPcmConversionArgs(audioPath, convertedPath), {
      timeoutMs: FFMPEG_CONVERSION_TIMEOUT_MS,
    });
    await run(cliPath, [
      "-m", modelPath,
      "-f", convertedPath,
      "-l", normalizeLanguage(language),
      "-oj",
      "-of", outputBase,
      "-np",
    ], { cwd: temporaryRoot, timeoutMs: WHISPER_TIMEOUT_MS });
    const json = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return {
      engine: "whisper.cpp",
      modelPath,
      words: segmentWords(json.transcription ?? []),
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function findWhisperCli({ resourcesPath, appPath, requireBundled = false }) {
  const extension = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    process.env.WHISPER_CLI_PATH,
    resourcesPath && path.join(resourcesPath, `whisper-cli${extension}`),
    resourcesPath && path.join(resourcesPath, "bin", `whisper-cli${extension}`),
    appPath && path.join(appPath, "vendor", "bin", `whisper-cli${extension}`),
    appPath && path.join(appPath, "vendor", `whisper-cli${extension}`),
    process.cwd() && path.join(process.cwd(), "vendor", "bin", `whisper-cli${extension}`),
    process.cwd() && path.join(process.cwd(), "vendor", `whisper-cli${extension}`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore", timeout: 5000 });
      if (result.status === 0) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  if (requireBundled) {
    return null;
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
    resourcesPath && path.join(resourcesPath, "models", "ggml-small.en.bin"),
    appPath && path.join(appPath, "models", "ggml-small.en.bin"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (userDataPath && path.resolve(candidate) === path.resolve(path.join(userDataPath, "models", "ggml-small.en.bin"))) {
        const status = await modelStatus(userDataPath);
        if (!status.available) {
          continue;
        }
      } else if (candidate === process.env.WHISPER_MODEL_PATH) {
        // An explicitly selected path is still verified before it is handed
        // to whisper.cpp; this prevents a stale or partial override from
        // silently producing an invalid proof run.
        const status = await modelStatusForFile(candidate);
        if (!status.available) {
          continue;
        }
      } else {
        const status = await modelStatusForFile(candidate);
        if (!status.available) {
          continue;
        }
      }
      return candidate;
    } catch {
      // Try the next local cache location.
    }
  }
  return null;
}

function segmentWords(segments) {
  if (!Array.isArray(segments)) {
    throw new Error("Whisper output did not contain a transcription array");
  }
  const words = [];
  for (const segment of segments) {
    const tokenWords = segmentTokenWords(segment);
    if (tokenWords.length > 0) {
      words.push(...tokenWords);
      continue;
    }
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

function normalizeLanguage(language) {
  if (typeof language !== "string" || !/^[a-z]{2,8}(?:-[a-z]{2,8})?$/iu.test(language.trim())) {
    return "en";
  }
  return language.trim();
}

/** Prefer token-level timestamps when a whisper.cpp JSON build includes them. */
function segmentTokenWords(segment) {
  if (!Array.isArray(segment.tokens)) {
    return [];
  }
  const wordTokens = segment.tokens.filter((token) => {
    const text = String(token?.text ?? "").trim();
    return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length > 0;
  });
  if (wordTokens.length === 0) {
    return [];
  }
  const tokenWords = wordTokens.map((token) => {
    const text = String(token?.text ?? "").trim();
    const normalized = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
    if (!normalized || normalized.length === 0) {
      return null;
    }
    const start = parseWhisperTimeOrNull(token?.offsets?.from, token?.timestamps?.from);
    const end = parseWhisperTimeOrNull(token?.offsets?.to, token?.timestamps?.to);
    if (start === null || end === null || end < start) {
      return null;
    }
    return normalized.map((word) => ({
      text: word,
      start,
      end,
      confidence: Number.isFinite(Number(token?.p)) ? Math.max(0, Math.min(1, Number(token.p))) : 0.75,
    }));
  });
  // A partial token timing set is less trustworthy than the segment timing;
  // falling back keeps words from being pinned at 0 seconds.
  return tokenWords.some((words) => words === null) ? [] : tokenWords.flat();
}

function parseWhisperTime(offsetMs, timestamp) {
  return parseWhisperTimeOrNull(offsetMs, timestamp) ?? 0;
}

function parseWhisperTimeOrNull(offsetMs, timestamp) {
  if (offsetMs !== null && offsetMs !== undefined && String(offsetMs).trim() !== "" && Number.isFinite(Number(offsetMs))) {
    return Number(offsetMs) / 1000;
  }
  const value = String(timestamp ?? "").trim();
  if (value.length === 0) {
    return null;
  }
  const parts = value.split(":");
  if (parts.length > 3 || parts.length < 1) {
    return null;
  }
  const secondsPart = parts.at(-1) ?? "";
  const [wholeSeconds, fraction = ""] = secondsPart.split(/[,.]/u, 2);
  const seconds = Number(wholeSeconds);
  if (!Number.isFinite(seconds) || seconds < 0 || (fraction && !/^\d+$/u.test(fraction))) {
    return null;
  }
  const minutes = parts.length >= 2 ? Number(parts.at(-2)) : 0;
  const hours = parts.length === 3 ? Number(parts.at(-3)) : 0;
  if (!Number.isFinite(minutes) || !Number.isFinite(hours) || minutes < 0 || hours < 0) {
    return null;
  }
  const fractionalSeconds = fraction.length > 0 ? Number(`0.${fraction}`) : 0;
  return hours * 3600 + minutes * 60 + seconds + fractionalSeconds;
}

function buildPcmConversionArgs(inputPath, outputPath) {
  return [
    "-y", "-v", "error", "-i", inputPath,
    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath,
  ];
}

function run(command, args, options = {}) {
  return runCommand(command, args, {
    ...options,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
    maxOutputBytes: options.maxOutputBytes ?? 50_000_000,
  });
}

module.exports = { buildPcmConversionArgs, parseWhisperTime, transcribeAudio, segmentWords, segmentTokenWords };
