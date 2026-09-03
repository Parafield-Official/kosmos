const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runCommand } = require("./process.cjs");
const { resolveRuntimeBinary } = require("./runtime.cjs");

const WHISPERX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu;

function buildWhisperXArgs({
  audioPath,
  outputDir,
  modelDir,
  language = "en",
  model = "small.en",
}) {
  return [
    audioPath,
    "--model", model,
    "--language", normalizeLanguage(language),
    "--device", "cpu",
    "--compute_type", "int8",
    "--batch_size", "4",
    "--vad_method", "silero",
    "--output_dir", outputDir,
    "--output_format", "json",
    "--model_dir", modelDir,
    "--verbose", "False",
    "--print_progress", "False",
  ];
}

function parseWhisperXWords(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.word_segments)) {
    throw new Error("WhisperX output did not contain forced-aligned word segments.");
  }
  const words = [];
  for (const entry of value.word_segments) {
    const start = Number(entry?.start);
    const end = Number(entry?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      continue;
    }
    const tokens = String(entry?.word ?? "").match(WORD_PATTERN) ?? [];
    if (tokens.length === 0) {
      continue;
    }
    const confidence = Number.isFinite(Number(entry?.score))
      ? Math.max(0, Math.min(1, Number(entry.score)))
      : 0.75;
    for (const token of tokens) {
      words.push({ text: token, start, end, confidence });
    }
  }
  if (words.length === 0) {
    throw new Error("WhisperX did not align any spoken words.");
  }
  return words;
}

function resolveWhisperXCommand({
  resourcesPath,
  appPath,
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  requireBundled = false,
} = {}) {
  const extension = platform === "win32" ? ".exe" : "";
  const executableName = `whisperx${extension}`;
  const packagedCandidates = [
    resourcesPath && path.join(resourcesPath, "whisperx", executableName),
    appPath && path.join(appPath, "vendor", "whisperx-runtime", "whisperx", executableName),
    cwd && path.join(cwd, "vendor", "whisperx-runtime", "whisperx", executableName),
  ].filter(Boolean);
  for (const candidate of packagedCandidates) {
    try {
      if (fsSync.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Try the next packaged layout before consulting developer installs.
    }
  }

  const configured = resolveRuntimeBinary({
    name: "whisperx",
    envVar: "WHISPERX_PATH",
    resourcesPath,
    appPath,
    cwd,
    platform,
    env,
    requireBundled,
  });
  if (configured !== "whisperx") {
    return configured;
  }
  const home = os.homedir();
  const userCandidates = [
    path.join(home, ".local", "bin", `whisperx${extension}`),
    path.join(home, ".local", "share", "uv", "tools", "whisperx", "bin", `whisperx${extension}`),
  ];
  return userCandidates.find((candidate) => {
    try {
      return fsSync.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) ?? configured;
}

async function alignImportedAudioWithWhisperX({
  audioPath,
  userDataPath,
  resourcesPath,
  appPath,
  language = "en",
  requireBundled = false,
  resolveCommand = resolveWhisperXCommand,
  run = runCommand,
}) {
  const command = resolveCommand({ resourcesPath, appPath, requireBundled });
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-whisperx-"));
  const modelDir = path.join(userDataPath, "models", "whisperx");
  const helperPath = [
    resourcesPath && path.join(resourcesPath, "bin"),
    appPath && path.join(appPath, "vendor", "bin"),
    path.join(process.cwd(), "vendor", "bin"),
    process.env.PATH,
  ].filter(Boolean).join(path.delimiter);
  try {
    await fs.mkdir(modelDir, { recursive: true });
    await run(command, buildWhisperXArgs({
      audioPath,
      outputDir: temporaryRoot,
      modelDir,
      language,
    }), {
      cwd: temporaryRoot,
      timeoutMs: WHISPERX_TIMEOUT_MS,
      maxOutputBytes: 50_000_000,
      env: {
        TOKENIZERS_PARALLELISM: "false",
        OMP_NUM_THREADS: String(Math.min(6, Math.max(2, os.cpus().length))),
        TORCH_HOME: path.join(modelDir, "torch"),
        MPLCONFIGDIR: path.join(modelDir, "matplotlib"),
        PATH: helperPath,
      },
    });
    const outputPath = path.join(temporaryRoot, `${path.parse(audioPath).name}.json`);
    const value = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return {
      engine: "whisperx",
      modelPath: modelDir,
      words: parseWhisperXWords(value),
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcribeImportedAudio({ alignWithWhisperX, transcribeWithWhisper, onFallback }) {
  try {
    const aligned = await alignWithWhisperX();
    if (!aligned || !Array.isArray(aligned.words) || aligned.words.length === 0) {
      throw new Error("WhisperX returned no aligned words.");
    }
    return { ...aligned, timingEngine: "whisperx", alignmentFallback: false };
  } catch (error) {
    onFallback?.(error);
    const fallback = await transcribeWithWhisper();
    return { ...fallback, timingEngine: "whisper.cpp", alignmentFallback: true };
  }
}

function normalizeLanguage(language) {
  if (typeof language !== "string" || !/^[a-z]{2,8}(?:-[a-z]{2,8})?$/iu.test(language.trim())) {
    return "en";
  }
  return language.trim().toLowerCase();
}

module.exports = {
  WHISPERX_TIMEOUT_MS,
  alignImportedAudioWithWhisperX,
  buildWhisperXArgs,
  parseWhisperXWords,
  resolveWhisperXCommand,
  transcribeImportedAudio,
};
