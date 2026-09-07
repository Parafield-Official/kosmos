/**
 * Punch, master, and ACX export for Kosmos Labs.
 *
 * Original stays immutable. Punch rebuilds `{id}-working.wav` from original plus
 * a clip manifest. Master writes `{id}-mastered.wav` and leaves working alone.
 * Export encodes the mastered file (falling back to working) into `export/acx/`.
 */
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { workerData } = require("node:worker_threads");
const audioWorker = workerData?.kosmosAudioJob === true;
const { app, shell } = audioWorker
  ? { app: { getAppPath: () => workerData.appPath, isPackaged: workerData.isPackaged } }
  : require("electron");
const resourcesPath = audioWorker ? workerData.resourcesPath : process.resourcesPath;
const { runAudioJob } = require("./audio-job.cjs");
const { runCommand } = require("./process.cjs");
const { resolveRuntimeBinary } = require("./runtime.cjs");
const { replaceDirectory, writeFileAtomic } = require("./file-utils.cjs");
const {
  rebuildPunchTimeline,
  normalizePunchBounds,
  latestActivePunch,
  buildPunchPreview,
} = require("./punch.cjs");
const { normalizeAudioFormat } = require("./audio-metadata.cjs");
const {
  assertProjectFolder,
  ensureProjectDirectory,
  projectAssetPath,
  projectAudioPath,
} = require("./project-path.cjs");

const MAX_AUDIO_SECONDS = 2 * 60 * 60;
const MAX_PCM_OUTPUT_BYTES = 1_500_000_000;
const MAX_RECORDER_WAV_BYTES = 1_500_000_000;
const FFMPEG_TIMEOUT_MS = 60 * 60 * 1000;
const SILENCE_SAMPLE_RATE = 8000;

function loadCoreModule(name) {
  const candidates = [
    path.join(app.getAppPath(), "dist-core", `${name}.cjs`),
    path.join(__dirname, "..", "dist-core", `${name}.cjs`),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next build location.
    }
  }
  throw new Error("The audio core is not bundled. Run npm run build:core first.");
}

function presetFromPayload(masterCore, payload) {
  const id = typeof payload?.presetId === "string" ? payload.presetId : "acx";
  return masterCore.resolvePreset(id);
}

function safeProjectFileName(file, label = "File") {
  if (
    typeof file !== "string"
    || file.length === 0
    || file === "."
    || file === ".."
    || file.includes("/")
    || file.includes("\\")
  ) {
    throw new Error(`${label} must be a single file name.`);
  }
  return file;
}

function audioPath(folder, file) {
  return projectAudioPath(folder, `audio/${safeProjectFileName(file, "Audio file")}`);
}

function pickupClipPath(folder, file) {
  return projectAudioPath(folder, `audio/pickups/${safeProjectFileName(file, "Pickup file")}`);
}

function runFfmpeg(args, options = {}) {
  return runCommand(
    resolveRuntimeBinary({
      name: "ffmpeg",
      envVar: "FFMPEG_PATH",
      resourcesPath,
      appPath: app.getAppPath(),
      requireBundled: app.isPackaged,
    }),
    args,
    { ...options, timeoutMs: options.timeoutMs ?? FFMPEG_TIMEOUT_MS },
  );
}

function runFfprobe(args) {
  return runCommand(
    resolveRuntimeBinary({
      name: "ffprobe",
      envVar: "FFPROBE_PATH",
      resourcesPath,
      appPath: app.getAppPath(),
      requireBundled: app.isPackaged,
    }),
    args,
    { timeoutMs: 60_000 },
  );
}

/** True when the buffer already carries a RIFF/WAVE header. */
function isWavBuffer(bytes) {
  return (
    Buffer.isBuffer(bytes)
    && bytes.length >= 12
    && bytes.toString("latin1", 0, 4) === "RIFF"
    && bytes.toString("latin1", 8, 12) === "WAVE"
  );
}

/**
 * Re-encode any imported take into a PCM16 WAV so the chapter tape model stays
 * two honest `.wav` files. Sample rate and channels are preserved; only the
 * container/codec is normalized. WAV input is passed straight through by the
 * caller, so this only runs for imported mp3/m4a/ogg/webm takes.
 */
async function transcodeToWav(inputBytes) {
  if (inputBytes.length > MAX_RECORDER_WAV_BYTES) {
    throw new Error("Imported audio is larger than Kosmos's supported audio limit.");
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-labs-import-"));
  const inputPath = path.join(tmpDir, "import");
  const outputPath = path.join(tmpDir, "import.wav");
  try {
    await fs.writeFile(inputPath, inputBytes);
    await runFfmpeg(["-y", "-v", "error", "-i", inputPath, "-c:a", "pcm_s16le", outputPath]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function float32View(bytes) {
  if (bytes.byteLength % 4 !== 0) {
    throw new Error("Decoded PCM output is not aligned to 32-bit samples");
  }
  if (bytes.byteOffset % 4 === 0) {
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

function mixInterleavedToMono(samples, channels) {
  const count = Math.max(1, Math.floor(channels || 1));
  if (count === 1) {
    return samples instanceof Float32Array ? samples : Float32Array.from(samples);
  }
  const frames = Math.floor(samples.length / count);
  const output = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < count; channel += 1) {
      sum += samples[frame * count + channel];
    }
    output[frame] = sum / count;
  }
  return output;
}

function resampleLinearArray(samples, fromRate, toRate) {
  if (samples.length === 0 || fromRate <= 0 || fromRate === toRate) {
    return samples instanceof Float32Array ? samples : Float32Array.from(samples);
  }
  const length = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[Math.min(samples.length - 1, left)] ?? 0;
    const b = samples[Math.min(samples.length - 1, left + 1)] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

function slugFileName(value) {
  return String(value ?? "manual")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "manual";
}

function activePunches(punches, chapterId) {
  return (punches ?? []).filter((punch) =>
    punch?.chapter_id === chapterId
    && punch.edit_status !== "reverted"
    && typeof punch.path === "string"
    && Number.isFinite(punch.t_start)
    && Number.isFinite(punch.t_end)
    && punch.t_end > punch.t_start,
  );
}

async function decodeMono44100(filePath) {
  const pcm = await runFfmpeg([
    "-v", "error", "-i", filePath,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", "44100", "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % 4 !== 0) {
    throw new Error("Audio decoder returned no complete mono PCM frames");
  }
  const duration = pcm.length / 4 / 44100;
  if (!Number.isFinite(duration) || duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Decoded audio exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute limit.`);
  }
  return float32View(pcm);
}

async function probeAudio(filePath) {
  const output = await runFfprobe([
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=channels,sample_rate,duration,bit_rate,codec_name:format=duration,bit_rate,format_name",
    "-of", "json", filePath,
  ]);
  const value = JSON.parse(output.toString("utf8"));
  const stream = value.streams?.[0] ?? {};
  const format = value.format ?? {};
  const channels = Math.max(1, Number(stream.channels) || 1);
  const sampleRate = Math.max(1, Number(stream.sample_rate) || 44100);
  const duration = Number(stream.duration ?? format.duration) || 0;
  const bitrate = Number(stream.bit_rate ?? format.bit_rate);
  return {
    channels,
    sampleRate,
    duration,
    bitrateKbps: Number.isFinite(bitrate) ? bitrate / 1000 : undefined,
    // ffprobe's codec_name describes the encoded samples (for example
    // `pcm_s16le`), not the file container. ACX checks the latter, so keep
    // this aligned with the main audio path and normalize both fields.
    format: normalizeAudioFormat(path.extname(filePath), stream.codec_name, format.format_name),
  };
}

async function decodeAudioPcm(filePath, targetSampleRate) {
  const metadata = await probeAudio(filePath);
  // FFmpeg applies anti-alias filtering when converting to the delivery rate.
  // Do this before the JS core, whose linear interpolation is not a low-pass filter.
  const sampleRate = targetSampleRate ?? metadata.sampleRate;
  if (metadata.duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Audio exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute decode limit.`);
  }
  const pcm = await runFfmpeg([
    "-v", "error", "-i", filePath,
    "-f", "f32le", "-acodec", "pcm_f32le",
    "-ac", String(metadata.channels),
    "-ar", String(sampleRate),
    "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % (4 * metadata.channels) !== 0) {
    throw new Error("Audio decoder returned no complete PCM frames");
  }
  return { ...metadata, sampleRate, pcm };
}

async function repairAudioFile(masterCore, filePath, metadata) {
  const pcm = await runFfmpeg([
    "-v", "error",
    "-i", filePath,
    "-af", masterCore.AUTOMATIC_REPAIR_FILTER,
    "-f", "f32le",
    "-acodec", "pcm_f32le",
    "-ac", String(metadata.channels),
    "-ar", String(metadata.sampleRate),
    "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % (4 * metadata.channels) !== 0) {
    throw new Error("Automatic click and clipping repair returned no complete PCM frames.");
  }
  return { ...metadata, pcm };
}

async function denoiseAudioFile(masterCore, metadata, noiseFloorDbfs, reductionDb, selection = null) {
  if (metadata.channels !== 1) throw new Error("Restoration requires the prepared mono signal.");
  const samples = float32View(metadata.pcm);
  const rate = metadata.sampleRate;
  const delay = masterCore.denoiseDelaySamples(rate);
  const prefixLength = selection ? rate : 0;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-denoise-"));
  try {
    const inputPath = path.join(directory, "prepared.f32");
    const prefix = new Float32Array(prefixLength);
    if (selection) {
      if (!Number.isInteger(selection.startSample) || !Number.isInteger(selection.sampleCount) ||
          selection.sampleCount <= 0 || selection.startSample < 0 ||
          selection.startSample + selection.sampleCount > samples.length) throw new Error("Invalid noise profile window.");
      for (let i = 0; i < prefix.length; i++) prefix[i] = samples[selection.startSample + i % selection.sampleCount];
    }
    await fs.writeFile(inputPath, Buffer.from(prefix.buffer));
    // Every attempt starts from the same repaired source. Do not compound
    // denoising, decode the lossy original again, or lose the filter's tail.
    await fs.appendFile(inputPath, metadata.pcm);
    await fs.appendFile(inputPath, Buffer.alloc((delay + Math.ceil(rate * 0.1)) * 4));
    const denoise = selection
      ? masterCore.profiledAfftdnFilter(noiseFloorDbfs, reductionDb)
      : masterCore.afftdnFilter(noiseFloorDbfs, reductionDb);
    const start = prefixLength + delay;
    const filter = `${denoise},atrim=start_sample=${start}:end_sample=${start + samples.length},asetpts=PTS-STARTPTS`;
    const pcm = await runFfmpeg([
      "-v", "error", "-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", inputPath,
      "-af", filter, "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", String(rate), "pipe:1",
    ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
    if (pcm.length !== metadata.pcm.length) throw new Error("Noise cleanup changed the recording length.");
    return { ...metadata, pcm };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function punchSamplesFromWav(audioCore, spliceCore, bytes, trimSilence) {
  const decoded = audioCore.decodeWavPcm16(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  let samples = mixInterleavedToMono(decoded.samples, decoded.channels);
  samples = resampleLinearArray(samples, decoded.sampleRate, 44100);
  if (trimSilence !== false) {
    samples = spliceCore.trimPunchSilence(samples, 44100, { threshold: 0.01, padMs: 50 });
  }
  return samples instanceof Float32Array ? samples : Float32Array.from(samples);
}

async function loadPunchClip(folder, punch, audioCore, spliceCore) {
  const bytes = await fs.readFile(pickupClipPath(folder, punch.path));
  return punchSamplesFromWav(audioCore, spliceCore, bytes, punch.trim_silence);
}

async function applyPunch(payload) {
  let folder = payload?.folder;
  const chapterId = payload?.chapterId;
  const originalFile = payload?.originalFile;
  const workingFile = payload?.workingFile;
  if (typeof folder !== "string" || typeof chapterId !== "string" || typeof originalFile !== "string") {
    return { ok: false, reason: "A project folder, chapter, and original tape are required." };
  }
  if (typeof payload?.wavBase64 !== "string" || payload.wavBase64.length < 44) {
    return { ok: false, reason: "Punch recording did not contain a WAV file." };
  }
  if (!Number.isFinite(payload?.tStart) || !Number.isFinite(payload?.tEnd) || payload.tEnd <= payload.tStart) {
    return { ok: false, reason: "Punch boundaries must be a valid time range." };
  }
  folder = await assertProjectFolder(folder);

  const audioCore = loadCoreModule("audio");
  const spliceCore = loadCoreModule("splice");
  const replacementBytes = Buffer.from(payload.wavBase64, "base64");
  if (replacementBytes.length > MAX_RECORDER_WAV_BYTES) {
    return { ok: false, reason: "Punch WAV is larger than Kosmos's supported audio limit." };
  }

  let replacementSamples;
  try {
    replacementSamples = punchSamplesFromWav(audioCore, spliceCore, replacementBytes, payload.trimSilence);
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
  if (!replacementSamples.length) {
    return { ok: false, reason: "Punch WAV contains no audio samples." };
  }

  const destName = typeof workingFile === "string" && workingFile
    ? safeProjectFileName(workingFile, "Working file")
    : `${slugFileName(chapterId)}-working.wav`;
  const originalAbsolute = audioPath(folder, originalFile);
  const workingAbsolute = audioPath(folder, destName);

  let original;
  let current;
  try {
    original = await decodeMono44100(originalAbsolute);
    current = fsSync.existsSync(workingAbsolute)
      ? await decodeMono44100(workingAbsolute)
      : original;
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }

  const currentDuration = current.length / 44100;
  let punchBounds;
  try {
    punchBounds = normalizePunchBounds(payload.tStart, payload.tEnd, currentDuration);
  } catch {
    return {
      ok: false,
      reason: `Punch boundaries must stay within the attached take (0.000–${currentDuration.toFixed(3)} seconds).`,
    };
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const clipName = `${slugFileName(chapterId)}-${slugFileName(payload.pickupId || "manual")}-${stamp}.wav`;
  const nextPunch = {
    id: `punch-${stamp}-${crypto.randomUUID().slice(0, 8)}`,
    chapter_id: chapterId,
    pickup_id: typeof payload.pickupId === "string" ? payload.pickupId : undefined,
    expected: typeof payload.expected === "string" ? payload.expected.slice(0, 1000) : undefined,
    heard: typeof payload.heard === "string" ? payload.heard.slice(0, 1000) : undefined,
    path: clipName,
    t_start: punchBounds.start,
    t_end: punchBounds.end,
    trim_silence: payload.trimSilence !== false,
    edit_status: "applied",
    created_at: new Date().toISOString(),
  };
  const chapterPunches = [...activePunches(payload.punches, chapterId), nextPunch];

  const rollbackAbsolute = `${workingAbsolute}.rollback-${process.pid}-${crypto.randomUUID()}`;
  let hadWorking = false;
  try {
    await fs.access(workingAbsolute);
    hadWorking = true;
    await fs.copyFile(workingAbsolute, rollbackAbsolute);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  }

  try {
    await writeFileAtomic(pickupClipPath(folder, clipName), replacementBytes);
    const edited = await rebuildPunchTimeline({
      original,
      punches: chapterPunches,
      sampleRate: 44100,
      loadReplacement: async (punch) => {
        if (punch.id === nextPunch.id) {
          return replacementSamples;
        }
        return loadPunchClip(folder, punch, audioCore, spliceCore);
      },
      splicePunch: spliceCore.splicePunch,
    });
    await writeFileAtomic(
      workingAbsolute,
      Buffer.from(audioCore.encodeWavPcm16(edited, 44100, 1)),
    );
    if (hadWorking) {
      await fs.rm(rollbackAbsolute, { force: true }).catch(() => undefined);
    }
    const durationDelta = (edited.length - current.length) / 44100;
    nextPunch.duration_delta = durationDelta;
    return {
      ok: true,
      workingFile: destName,
      punch: nextPunch,
      punches: [...(payload.punches ?? []).filter((punch) => punch?.chapter_id === chapterId), nextPunch],
      appliedStart: punchBounds.start,
      appliedEnd: punchBounds.end,
      durationDelta,
    };
  } catch (error) {
    await fs.rm(pickupClipPath(folder, clipName), { force: true }).catch(() => undefined);
    if (hadWorking) {
      await fs.copyFile(rollbackAbsolute, workingAbsolute).catch(() => undefined);
      await fs.rm(rollbackAbsolute, { force: true }).catch(() => undefined);
    } else {
      await fs.rm(workingAbsolute, { force: true }).catch(() => undefined);
    }
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

async function undoLatestPunch(payload) {
  let folder = payload?.folder;
  const chapterId = payload?.chapterId;
  const originalFile = payload?.originalFile;
  const workingFile = payload?.workingFile;
  if (typeof folder !== "string" || typeof chapterId !== "string" || typeof originalFile !== "string") {
    return { ok: false, reason: "A project folder, chapter, and original tape are required." };
  }
  const latest = latestActivePunch(payload.punches ?? [], chapterId);
  if (!latest) {
    return { ok: false, reason: "This chapter has no applied pickup to undo." };
  }
  folder = await assertProjectFolder(folder);

  const destName = typeof workingFile === "string" && workingFile
    ? safeProjectFileName(workingFile, "Working file")
    : `${slugFileName(chapterId)}-working.wav`;
  const audioCore = loadCoreModule("audio");
  const spliceCore = loadCoreModule("splice");
  const remaining = activePunches(payload.punches, chapterId).filter((punch) => punch.id !== latest.id);

  try {
    const original = await decodeMono44100(audioPath(folder, originalFile));
    const edited = await rebuildPunchTimeline({
      original,
      punches: remaining,
      sampleRate: 44100,
      loadReplacement: (punch) => loadPunchClip(folder, punch, audioCore, spliceCore),
      splicePunch: spliceCore.splicePunch,
    });
    await writeFileAtomic(
      audioPath(folder, destName),
      Buffer.from(audioCore.encodeWavPcm16(edited, 44100, 1)),
    );
    const punches = (payload.punches ?? []).map((punch) =>
      punch.id === latest.id ? { ...punch, edit_status: "reverted" } : punch,
    );
    return { ok: true, workingFile: destName, punches, undonePunchId: latest.id };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

function reportStatus(report) {
  if (report.traffic_light === "red") {
    return "fail";
  }
  if (report.traffic_light === "yellow") {
    return "warn";
  }
  return "pass";
}

async function masterWorkingFile(payload) {
  if (!audioWorker) {
    try {
      return await runAudioJob("master", payload, { appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath });
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  }
  let folder = payload?.folder;
  const workingFile = payload?.workingFile;
  const chapterId = typeof payload?.chapterId === "string" ? payload.chapterId : null;
  if (typeof folder !== "string" || typeof workingFile !== "string") {
    return { ok: false, reason: "A working file is required to master." };
  }
  folder = await assertProjectFolder(folder);
  const filePath = audioPath(folder, workingFile);
  const destName = chapterId
    ? `${slugFileName(chapterId)}-mastered.wav`
    : safeProjectFileName(String(workingFile).replace(/-working(\.[^.]+)?$/i, "-mastered$1"), "Mastered file");
  const destPath = audioPath(folder, destName);
  const masterCore = loadCoreModule("master");
  const audioCore = loadCoreModule("audio");
  const preset = presetFromPayload(masterCore, payload);
  const profile = masterCore.deliveryProfile(preset);

  try {
    const decoded = await decodeAudioPcm(filePath, profile.sampleRate);
    const repaired = await repairAudioFile(masterCore, filePath, decoded);
    const repairAssessment = masterCore.assessRepairCandidate(
      float32View(decoded.pcm),
      float32View(repaired.pcm),
    );
    if (repairAssessment.applied && !repairAssessment.safe) {
      return {
        ok: false,
        reason: `${repairAssessment.reason} Record a cleaner pickup instead of applying a destructive whole-file repair.`,
      };
    }
    const prepared = repairAssessment.applied ? repaired : decoded;
    const requestedRms = Number(payload?.targetRmsDbfs);
    const masterOptions = {
      preset,
      profile,
      targetRmsDbfs: Number.isFinite(requestedRms)
        ? Math.min(-18, Math.max(-23, requestedRms))
        : -20,
      // MP3 reconstruction can overshoot a PCM ceiling. Leave delivery margin.
      limiterCeilingDbfs: profile.container === "mp3" ? Math.min(profile.limiterCeilingDbfs, (preset.true_peak_dbfs_max ?? -3) - 0.8) : profile.limiterCeilingDbfs,
    };
    const runMaster = (audio, options) => masterCore.masterPcm({
      samples: float32View(audio.pcm), sampleRate: audio.sampleRate, channels: audio.channels,
      format: audio.format, bitrate_kbps: audio.bitrateKbps,
    }, options);
    let master = runMaster(prepared, masterOptions);
    let restoration = { method: "none", reductionDb: 0, targetRmsDbfs: masterOptions.targetRmsDbfs };

    if (master.status !== "ok" && master.abort_code === "noise_floor" && profile.noiseFloorMaxDbfs !== null) {
      const sourceReport = master.before;
      const sourceNoiseFloor = master.before.noise_floor_dbfs;
      const sourcePrediction = master.predicted_floor_dbfs;
      const quieterTarget = masterCore.quieterRmsTarget(preset, masterOptions.targetRmsDbfs);
      const options = [masterOptions];
      if (quieterTarget !== undefined) {
        options.push({ ...masterOptions, targetRmsDbfs: quieterTarget });
        // Less amplification can avoid any denoising at all.
        master = runMaster(prepared, options[1]);
        if (master.status === "ok") restoration = { ...restoration, targetRmsDbfs: quieterTarget };
      }
      const mono = mixInterleavedToMono(float32View(prepared.pcm), prepared.channels);
      const monoAudio = { ...prepared, channels: 1, pcm: Buffer.from(mono.buffer, mono.byteOffset, mono.byteLength) };
      const selection = masterCore.selectNoiseProfile(mono, prepared.sampleRate, sourceReport);
      const strengths = masterCore.noiseReductionAttempts(
        sourcePrediction + ((quieterTarget ?? masterOptions.targetRmsDbfs) - masterOptions.targetRmsDbfs),
        profile.noiseFloorMaxDbfs,
      );
      let rejectedForVoice = false;
      restorationAttempts:
      for (const noiseProfile of selection ? [selection, null] : [null]) {
        if (master.status === "ok") break;
        for (const strength of strengths) {
          const cleaned = await denoiseAudioFile(masterCore, monoAudio, sourceNoiseFloor, strength, noiseProfile);
          const assessment = masterCore.assessDenoiseCandidate(mono, float32View(cleaned.pcm), prepared.sampleRate, sourceNoiseFloor);
          if (!assessment.safe) { rejectedForVoice = true; continue; }
          for (const option of options) {
            master = runMaster(cleaned, option);
            if (master.status === "ok") {
              restoration = {
                method: noiseProfile ? "learned_profile" : "adaptive", reductionDb: strength,
                targetRmsDbfs: option.targetRmsDbfs,
                ...(noiseProfile ? { profileStartSeconds: noiseProfile.startSample / prepared.sampleRate, profileDurationSeconds: noiseProfile.sampleCount / prepared.sampleRate } : {}),
              };
              break restorationAttempts;
            }
            if (master.abort_code !== "noise_floor" && master.abort_code !== "level") break restorationAttempts;
          }
        }
      }
      if (master.status !== "ok" && rejectedForVoice) {
        return { ok: false, reason: `${master.abort_reason ?? "Mastering stopped."} Stronger automatic cleanup was withheld to protect the voice.` };
      }
    }

    if (master.status !== "ok") {
      return { ok: false, reason: master.abort_reason ?? "Mastering stopped." };
    }

    await writeFileAtomic(
      destPath,
      Buffer.from(audioCore.encodeWavPcm16(master.samples, master.sampleRate, 1)),
    );
    return {
      ok: true,
      workingFile: safeProjectFileName(workingFile, "Working file"),
      masteredFile: destName,
      after: master.after ?? master.before,
      rms_dbfs: master.after?.rms_dbfs ?? master.before.rms_dbfs,
      restoration,
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

async function encodeDeliveryAudio(inputPath, outputPath, profile, durationSeconds) {
  const args = [
    "-y", "-v", "error",
    "-f", "f32le", "-ar", String(profile.sampleRate), "-ac", String(profile.channels),
    "-t", String(Math.max(0, durationSeconds)),
    "-i", inputPath,
    "-map_metadata", "-1",
  ];
  if (profile.container === "mp3") {
    args.push(
      "-codec:a", "libmp3lame",
      "-b:a", `${profile.bitrateKbps ?? 192}k`,
      "-ar", String(profile.sampleRate),
      "-ac", String(profile.channels),
      "-write_xing", "0",
    );
  } else {
    args.push(
      "-codec:a", profile.pcmBitDepth === 24 ? "pcm_s24le" : "pcm_s16le",
      "-ar", String(profile.sampleRate),
      "-ac", String(profile.channels),
    );
  }
  args.push(outputPath);
  await runFfmpeg(args);
}

function chapterPackSource(chapter, handoff) {
  if (chapter?.mastered && chapter?.masteredFile) {
    return chapter.masteredFile;
  }
  if (chapter?.workingFile) {
    return chapter.workingFile;
  }
  if (handoff && chapter?.originalFile) {
    return chapter.originalFile;
  }
  return null;
}

function failedAudioChecks(report) {
  const failed = Object.entries(report?.checks ?? {})
    .filter(([, status]) => status === "fail")
    .map(([name]) => name.replaceAll("_", " "));
  return failed.length ? failed.join(", ") : "audio checks failed";
}

/** Leave one second for MP3 frame padding so the encoded file stays <= 5m. */
function retailSampleRange(pcmLength, profile, retailSpec) {
  const start = Math.min(pcmLength, Math.round(profile.headSeconds * profile.sampleRate));
  const availableLength = Math.max(0, pcmLength - start);
  const minimumSamples = Math.round(retailSpec.min * profile.sampleRate);
  if (availableLength < minimumSamples) {
    return null;
  }
  const safeMaximumSeconds = Math.max(retailSpec.min, retailSpec.max - 1);
  return {
    start,
    length: Math.min(availableLength, Math.round(safeMaximumSeconds * profile.sampleRate)),
  };
}

async function exportDeliveryPack(payload) {
  let folder = payload?.folder;
  const handoff = payload?.mode === "handoff";
  const acxDelivery = payload?.mode === "acx";
  const incoming = Array.isArray(payload?.chapters) ? payload.chapters : [];
  const chapters = handoff
    ? incoming.filter((chapter) => chapterPackSource(chapter, true))
    : incoming;
  if (typeof folder !== "string") {
    return { ok: false, reason: "A project folder is required to export." };
  }
  if (chapters.length === 0) {
    return {
      ok: false,
      reason: handoff
        ? "Record at least one chapter before handing the book off."
        : "Add at least one chapter before exporting.",
    };
  }
  if (!handoff) {
    const missing = chapters.filter((chapter) => !chapter.masteredFile || !chapter.mastered);
    if (missing.length) {
      return {
        ok: false,
        reason: `Master every chapter first. Missing: ${missing.map((chapter) => chapter.title || chapter.id).slice(0, 3).join(", ")}.`,
      };
    }
  }
  folder = await assertProjectFolder(folder);

  const masterCore = loadCoreModule("master");
  const exportCore = loadCoreModule("export");
  const markersCore = loadCoreModule("markers");
  const preset = presetFromPayload(masterCore, acxDelivery ? { presetId: "acx" } : payload);
  const profile = masterCore.deliveryProfile(preset);
  const packName = handoff ? `${profile.folderName}-handoff` : profile.folderName;
  const exportRoot = await ensureProjectDirectory(folder, "export");
  const outputFolder = projectAssetPath(folder, `export/${safeProjectFileName(packName, "Export folder")}`);
  // Linked/external books may not have an export/ folder yet; the staging dir
  // is created inside it, so make sure it exists before mkdtemp.
  const stagingOutputFolder = await fs.mkdtemp(path.join(exportRoot, `.${packName}-staging-`));
  const temporaryFolder = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-labs-export-"));
  const entries = [];
  const outputFiles = [];
  let retailPcm = null;
  let retailChapterTitle = null;
  const retailSpec = exportCore.ACX_SPEC?.retail_sample_s ?? { min: 60, max: 300 };

  try {
    for (const [index, chapter] of chapters.entries()) {
      const sourceFile = chapterPackSource(chapter, handoff);
      if (!sourceFile) {
        continue;
      }
      const filePath = audioPath(folder, sourceFile);
      const decoded = await decodeAudioPcm(filePath, profile.sampleRate);
      const samples = mixInterleavedToMono(float32View(decoded.pcm), decoded.channels);
      const resampled = resampleLinearArray(samples, decoded.sampleRate, profile.sampleRate);
      const before = masterCore.measurePcm({
        samples: resampled,
        sampleRate: profile.sampleRate,
        channels: 1,
        format: decoded.format,
        bitrate_kbps: decoded.bitrateKbps,
      }, { preset });
      const fileName = exportCore.chapterFileName({ index: index + 1 }, profile.extension);
      const temporaryPcm = path.join(temporaryFolder, `${chapter.id}.f32le`);
      await fs.writeFile(temporaryPcm, Buffer.from(resampled.buffer, resampled.byteOffset, resampled.byteLength));
      const destination = path.join(stagingOutputFolder, fileName);
      await encodeDeliveryAudio(temporaryPcm, destination, profile, resampled.length / profile.sampleRate);
      const measured = await decodeAudioPcm(destination);
      const after = masterCore.measurePcm({
        samples: float32View(measured.pcm),
        sampleRate: measured.sampleRate,
        channels: measured.channels,
        format: profile.container,
        bitrate_kbps: measured.bitrateKbps,
        // This file was encoded immediately above with libmp3lame -b:a, no VBR quality flag.
        vbr: profile.container === "mp3" ? false : undefined,
      }, { preset });
      entries.push({
        fileName,
        before,
        after,
        status: reportStatus(after),
      });
      outputFiles.push(fileName);
      if (!retailPcm && retailSampleRange(resampled.length, profile, retailSpec)) {
        retailPcm = resampled;
        retailChapterTitle = chapter.title || `Chapter ${index + 1}`;
      }
    }

    const failed = entries.filter((entry) => entry.status === "fail");
    if (!handoff && failed.length) {
      const preview = failed.slice(0, 3).map((entry) => `${entry.fileName}: ${entry.note || failedAudioChecks(entry.after)}`).join("; ");
      throw new Error(`${preset.label} export stopped because ${failed.length} chapter${failed.length === 1 ? "" : "s"} failed: ${preview}. Remaster the affected chapters for ACX and try again.`);
    }

    const fakeProject = {
      chapters: chapters.map((chapter, index) => ({
        id: chapter.id,
        index: index + 1,
        title: chapter.title ?? `Chapter ${index + 1}`,
        text_path: "",
        audio_path: `audio/${chapterPackSource(chapter, handoff)}`,
        author_status: "approved",
      })),
    };
    const plan = exportCore.buildExportPlan(fakeProject, { profile });
    for (const readme of plan.readmeFiles) {
      await writeFileAtomic(path.join(stagingOutputFolder, readme.fileName), readme.contents, "utf8");
    }

    if (!handoff && profile.includeRetailSample) {
      if (!retailPcm) {
        throw new Error(`ACX needs a retail sample between ${retailSpec.min} and ${retailSpec.max} seconds. No mastered chapter is long enough; add or master a longer narration chapter.`);
      }
      const range = retailSampleRange(retailPcm.length, profile, retailSpec);
      if (range) {
        const sampleBytes = retailPcm.subarray(range.start, range.start + range.length);
        const samplePath = path.join(temporaryFolder, "retail.f32le");
        await fs.writeFile(samplePath, Buffer.from(sampleBytes.buffer, sampleBytes.byteOffset, sampleBytes.byteLength));
        const retailName = `99_retail_sample.${profile.extension}`;
        const retailOutput = path.join(stagingOutputFolder, retailName);
        await encodeDeliveryAudio(
          samplePath,
          retailOutput,
          profile,
          range.length / profile.sampleRate,
        );
        const decodedSample = await decodeAudioPcm(retailOutput);
        const sampleReport = masterCore.measurePcm({
          samples: float32View(decodedSample.pcm),
          sampleRate: decodedSample.sampleRate,
          channels: decodedSample.channels,
          format: decodedSample.format,
          bitrate_kbps: decodedSample.bitrateKbps,
          vbr: profile.container === "mp3" ? false : undefined,
        }, { preset, requireRoomTone: false });
        const encodedSeconds = decodedSample.pcm.length / 4 / decodedSample.channels / decodedSample.sampleRate;
        if (encodedSeconds < retailSpec.min || encodedSeconds > retailSpec.max) {
          throw new Error(`The encoded retail sample is ${encodedSeconds.toFixed(3)} seconds; ACX requires ${retailSpec.min}–${retailSpec.max} seconds.`);
        }
        if (reportStatus(sampleReport) === "fail") {
          throw new Error(`Retail sample failed ${failedAudioChecks(sampleReport)}. Remaster ${retailChapterTitle || "the source chapter"} for ACX and try again.`);
        }
        entries.push({
          fileName: retailName,
          after: sampleReport,
          status: reportStatus(sampleReport),
          note: `Created from ${retailChapterTitle || "the first eligible narration chapter"}; ${encodedSeconds.toFixed(1)} seconds after encoding.`,
        });
        outputFiles.push(retailName);
      }
    }

    await writeFileAtomic(path.join(stagingOutputFolder, "REPORT.txt"), exportCore.reportText(entries), "utf8");
    outputFiles.push("REPORT.txt");

    const allPickups = chapters.flatMap((chapter) =>
      Array.isArray(chapter.pickups) ? chapter.pickups : [],
    );
    if (allPickups.length) {
      // Markers are part of the same transaction as audio: publish the pack once.
      const markerDir = path.join(stagingOutputFolder, "markers");
      await fs.mkdir(markerDir, { recursive: true });
      const files = markersCore.markerFileSet("book", allPickups);
      for (const file of files) {
        await writeFileAtomic(path.join(markerDir, file.fileName), file.contents, "utf8");
        outputFiles.push(`markers/${file.fileName}`);
      }
    }

    const revealFile = exportCore.revealTargetInExportPack(outputFiles);
    await replaceDirectory(stagingOutputFolder, outputFolder);
    const reveal = path.join(outputFolder, revealFile);
    try {
      shell.showItemInFolder(fsSync.existsSync(reveal) ? reveal : outputFolder);
    } catch {
      // Finder is a courtesy.
    }
    return { ok: true, folder: outputFolder, files: outputFiles };
  } catch (error) {
    await fs.rm(stagingOutputFolder, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, reason: String(error?.message ?? error) };
  } finally {
    await fs.rm(temporaryFolder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Before/after clip around a punch, without writing the working file. */
async function previewPunch(payload) {
  let folder = payload?.folder;
  const originalFile = payload?.originalFile;
  const workingFile = payload?.workingFile;
  if (typeof folder !== "string" || typeof originalFile !== "string") {
    return { ok: false, reason: "A project folder and original tape are required." };
  }
  if (typeof payload?.wavBase64 !== "string" || payload.wavBase64.length < 44) {
    return { ok: false, reason: "Punch recording did not contain a WAV file." };
  }
  if (!Number.isFinite(payload?.tStart) || !Number.isFinite(payload?.tEnd) || payload.tEnd <= payload.tStart) {
    return { ok: false, reason: "Punch boundaries must be a valid time range." };
  }
  folder = await assertProjectFolder(folder);

  const audioCore = loadCoreModule("audio");
  const spliceCore = loadCoreModule("splice");
  const replacementBytes = Buffer.from(payload.wavBase64, "base64");
  if (replacementBytes.length > MAX_RECORDER_WAV_BYTES) {
    return { ok: false, reason: "Punch WAV is larger than Kosmos's supported audio limit." };
  }

  let replacementSamples;
  try {
    replacementSamples = punchSamplesFromWav(audioCore, spliceCore, replacementBytes, payload.trimSilence);
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
  if (!replacementSamples.length) {
    return { ok: false, reason: "Punch WAV contains no audio samples." };
  }

  const originalAbsolute = audioPath(folder, originalFile);
  const workingAbsolute = typeof workingFile === "string" && workingFile
    ? audioPath(folder, workingFile)
    : originalAbsolute;

  let current;
  try {
    current = fsSync.existsSync(workingAbsolute)
      ? await decodeMono44100(workingAbsolute)
      : await decodeMono44100(originalAbsolute);
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }

  try {
    const preview = buildPunchPreview({
      current,
      replacement: replacementSamples,
      sampleRate: 44100,
      startSeconds: payload.tStart,
      endSeconds: payload.tEnd,
      contextSeconds: 3,
      splicePunch: spliceCore.splicePunch,
    });
    return {
      ok: true,
      currentWavBase64: Buffer.from(audioCore.encodeWavPcm16(preview.currentContext, 44100, 1)).toString("base64"),
      patchedWavBase64: Buffer.from(audioCore.encodeWavPcm16(preview.patchedContext, 44100, 1)).toString("base64"),
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

/** ACX traffic-light report for a chapter working (or original) file. */
async function measureChapterAudio(payload) {
  if (!audioWorker) {
    try {
      return await runAudioJob("measure", payload, { appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath });
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  }
  let folder = payload?.folder;
  const file = payload?.file;
  if (typeof folder !== "string" || typeof file !== "string") {
    return { ok: false, reason: "A chapter audio file is required." };
  }
  try {
    folder = await assertProjectFolder(folder);
    const decoded = await decodeAudioPcm(audioPath(folder, file));
    const masterCore = loadCoreModule("master");
    const report = masterCore.measurePcm({
      samples: float32View(decoded.pcm),
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      format: decoded.format,
      bitrate_kbps: decoded.bitrateKbps,
    }, { preset: presetFromPayload(masterCore, payload) });
    return { ok: true, report };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

/** Measure quiet stretches from the recording itself for final proofing. */
async function measureSilences(audioPath, options = {}) {
  const pcm = await runFfmpeg([
    "-v", "error", "-i", audioPath,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", String(SILENCE_SAMPLE_RATE), "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % 4 !== 0) {
    return [];
  }
  return loadCoreModule("proof-silence").findSilences(
    float32View(pcm),
    SILENCE_SAMPLE_RATE,
    1,
    { minSeconds: options.minSeconds },
  );
}

module.exports = {
  applyPunch,
  previewPunch,
  undoLatestPunch,
  masterWorkingFile,
  measureChapterAudio,
  measureSilences,
  exportDeliveryPack,
  transcodeToWav,
  isWavBuffer,
  retailSampleRange,
};
