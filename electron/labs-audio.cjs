/**
 * Punch, master, and ACX export for Kosmos Labs.
 *
 * Original stays immutable. Punch rebuilds `{id}-working.wav` from original plus
 * a clip manifest. Master overwrites that working file in place. Export encodes
 * mastered working files into `export/acx/` — never a third chapter slot.
 */
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, shell } = require("electron");
const { runCommand } = require("./process.cjs");
const { resolveRuntimeBinary } = require("./runtime.cjs");
const {
  rebuildPunchTimeline,
  normalizePunchBounds,
  latestActivePunch,
} = require("./punch.cjs");

const MAX_AUDIO_SECONDS = 2 * 60 * 60;
const MAX_PCM_OUTPUT_BYTES = 1_500_000_000;
const MAX_RECORDER_WAV_BYTES = 1_500_000_000;
const FFMPEG_TIMEOUT_MS = 60 * 60 * 1000;

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

function audioPath(folder, file) {
  return path.join(folder, "audio", path.basename(file));
}

function pickupClipPath(folder, file) {
  return path.join(folder, "audio", "pickups", path.basename(file));
}

function runFfmpeg(args, options = {}) {
  return runCommand(
    resolveRuntimeBinary({
      name: "ffmpeg",
      envVar: "FFMPEG_PATH",
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      requireBundled: !app.isPackaged,
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
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      requireBundled: !app.isPackaged,
    }),
    args,
    { timeoutMs: 60_000 },
  );
}

async function writeFileAtomic(target, data, encoding) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}-${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmp, data, encoding);
  await fs.rename(tmp, target);
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
    format: String(stream.codec_name ?? format.format_name ?? (path.extname(filePath).slice(1) || "wav")).toLowerCase(),
  };
}

async function decodeAudioPcm(filePath) {
  const metadata = await probeAudio(filePath);
  if (metadata.duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Audio exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute decode limit.`);
  }
  const pcm = await runFfmpeg([
    "-v", "error", "-i", filePath,
    "-f", "f32le", "-acodec", "pcm_f32le",
    "-ac", String(metadata.channels),
    "-ar", String(metadata.sampleRate),
    "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % (4 * metadata.channels) !== 0) {
    throw new Error("Audio decoder returned no complete PCM frames");
  }
  return { ...metadata, pcm };
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

async function denoiseAudioFile(masterCore, filePath, metadata, noiseFloorDbfs, reductionDb, repairFilter) {
  const denoiseFilter = masterCore.afftdnFilter(noiseFloorDbfs, reductionDb);
  const filter = repairFilter ? `${repairFilter},${denoiseFilter}` : denoiseFilter;
  const pcm = await runFfmpeg([
    "-v", "error",
    "-i", filePath,
    "-af", filter,
    "-f", "f32le",
    "-acodec", "pcm_f32le",
    "-ac", String(metadata.channels),
    "-ar", String(metadata.sampleRate),
    "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % (4 * metadata.channels) !== 0) {
    throw new Error("Automatic noise reduction returned no complete PCM frames.");
  }
  return { ...metadata, pcm };
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
  const folder = payload?.folder;
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
    ? path.basename(workingFile)
    : `${path.basename(chapterId)}-working.wav`;
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
  const clipName = `${path.basename(chapterId)}-${slugFileName(payload.pickupId || "manual")}-${stamp}.wav`;
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
    return {
      ok: true,
      workingFile: destName,
      punch: nextPunch,
      punches: [...(payload.punches ?? []).filter((punch) => punch?.chapter_id === chapterId), nextPunch],
      appliedStart: punchBounds.start,
      appliedEnd: punchBounds.end,
      durationDelta: (edited.length - current.length) / 44100,
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
  const folder = payload?.folder;
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

  const destName = typeof workingFile === "string" && workingFile
    ? path.basename(workingFile)
    : `${path.basename(chapterId)}-working.wav`;
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
  const folder = payload?.folder;
  const workingFile = payload?.workingFile;
  if (typeof folder !== "string" || typeof workingFile !== "string") {
    return { ok: false, reason: "A working file is required to master." };
  }
  const filePath = audioPath(folder, workingFile);
  const masterCore = loadCoreModule("master");
  const audioCore = loadCoreModule("audio");
  const preset = masterCore.resolvePreset("acx");
  const profile = masterCore.deliveryProfile(preset);

  try {
    const decoded = await decodeAudioPcm(filePath);
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
    const masterOptions = {
      preset,
      profile,
      targetRmsDbfs: -20,
    };
    let master = masterCore.masterPcm({
      samples: float32View(prepared.pcm),
      sampleRate: prepared.sampleRate,
      channels: prepared.channels,
      format: prepared.format,
      bitrate_kbps: prepared.bitrateKbps,
    }, masterOptions);

    if (master.status !== "ok" && master.abort_code === "noise_floor" && profile.noiseFloorMaxDbfs !== null) {
      const strengths = masterCore.noiseReductionAttempts(
        master.predicted_floor_dbfs,
        profile.noiseFloorMaxDbfs,
      );
      for (const strength of strengths) {
        const cleaned = await denoiseAudioFile(
          masterCore,
          filePath,
          decoded,
          master.before.noise_floor_dbfs,
          strength,
          repairAssessment.applied ? masterCore.AUTOMATIC_REPAIR_FILTER : undefined,
        );
        master = masterCore.masterPcm({
          samples: float32View(cleaned.pcm),
          sampleRate: cleaned.sampleRate,
          channels: cleaned.channels,
          format: cleaned.format,
          bitrate_kbps: cleaned.bitrateKbps,
        }, masterOptions);
        if (master.status === "ok" || master.abort_code !== "noise_floor") {
          break;
        }
      }
    }

    if (master.status !== "ok") {
      return { ok: false, reason: master.abort_reason ?? "Mastering stopped." };
    }

    await writeFileAtomic(
      filePath,
      Buffer.from(audioCore.encodeWavPcm16(master.samples, master.sampleRate, 1)),
    );
    return {
      ok: true,
      workingFile: path.basename(workingFile),
      after: master.after ?? master.before,
      rms_dbfs: master.after?.rms_dbfs ?? master.before.rms_dbfs,
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

async function exportDeliveryPack(payload) {
  const folder = payload?.folder;
  const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
  if (typeof folder !== "string") {
    return { ok: false, reason: "A project folder is required to export." };
  }
  if (chapters.length === 0) {
    return { ok: false, reason: "Add at least one chapter before exporting." };
  }
  const missing = chapters.filter((chapter) => !chapter?.workingFile || !chapter.mastered);
  if (missing.length) {
    return {
      ok: false,
      reason: `Master every chapter first. Missing: ${missing.map((chapter) => chapter.title || chapter.id).slice(0, 3).join(", ")}.`,
    };
  }

  const masterCore = loadCoreModule("master");
  const exportCore = loadCoreModule("export");
  const markersCore = loadCoreModule("markers");
  const preset = masterCore.resolvePreset("acx");
  const profile = masterCore.deliveryProfile(preset);
  const outputFolder = path.join(folder, "export", profile.folderName);
  // Linked/external books may not have an export/ folder yet; the staging dir
  // is created inside it, so make sure it exists before mkdtemp.
  await fs.mkdir(path.dirname(outputFolder), { recursive: true });
  const stagingOutputFolder = await fs.mkdtemp(path.join(path.dirname(outputFolder), `.${profile.folderName}-staging-`));
  const temporaryFolder = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-labs-export-"));
  const entries = [];
  const outputFiles = [];
  let retailPcm = null;

  try {
    for (const [index, chapter] of chapters.entries()) {
      const filePath = audioPath(folder, chapter.workingFile);
      const decoded = await decodeAudioPcm(filePath);
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
      }, { preset });
      entries.push({
        fileName,
        before,
        after,
        status: reportStatus(after),
      });
      outputFiles.push(fileName);
      if (!retailPcm) {
        retailPcm = resampled;
      }
    }

    const failed = entries.filter((entry) => entry.status === "fail");
    if (failed.length) {
      const preview = failed.slice(0, 3).map((entry) => `${entry.fileName}: ${entry.note || `failed ${preset.label} checks`}`).join("; ");
      throw new Error(`${preset.label} export stopped because ${failed.length} chapter${failed.length === 1 ? "" : "s"} failed: ${preview}`);
    }

    const fakeProject = {
      chapters: chapters.map((chapter, index) => ({
        id: chapter.id,
        index: index + 1,
        title: chapter.title ?? `Chapter ${index + 1}`,
        text_path: "",
        audio_path: `audio/${chapter.workingFile}`,
        author_status: "approved",
      })),
    };
    const plan = exportCore.buildExportPlan(fakeProject, { profile });
    for (const readme of plan.readmeFiles) {
      await writeFileAtomic(path.join(stagingOutputFolder, readme.fileName), readme.contents, "utf8");
    }

    const retailSpec = exportCore.ACX_SPEC?.retail_sample_s ?? { min: 60, max: 300 };
    if (profile.includeRetailSample && retailPcm) {
      const start = Math.min(retailPcm.length, Math.round(profile.headSeconds * profile.sampleRate));
      const availableLength = Math.max(0, retailPcm.length - start);
      const minimumSamples = Math.round(retailSpec.min * profile.sampleRate);
      if (availableLength >= minimumSamples) {
        const sampleLength = Math.min(availableLength, Math.round(retailSpec.max * profile.sampleRate));
        const sampleBytes = retailPcm.subarray(start, start + sampleLength);
        const samplePath = path.join(temporaryFolder, "retail.f32le");
        await fs.writeFile(samplePath, Buffer.from(sampleBytes.buffer, sampleBytes.byteOffset, sampleBytes.byteLength));
        const retailName = `99_retail_sample.${profile.extension}`;
        await encodeDeliveryAudio(
          samplePath,
          path.join(stagingOutputFolder, retailName),
          profile,
          sampleLength / profile.sampleRate,
        );
        outputFiles.push(retailName);
      }
    }

    await writeFileAtomic(path.join(stagingOutputFolder, "REPORT.txt"), exportCore.reportText(entries), "utf8");
    outputFiles.push("REPORT.txt");

    await fs.mkdir(path.join(folder, "export"), { recursive: true });
    await fs.rm(outputFolder, { recursive: true, force: true });
    await fs.rename(stagingOutputFolder, outputFolder);

    const allPickups = chapters.flatMap((chapter) =>
      Array.isArray(chapter.pickups) ? chapter.pickups : [],
    );
    if (allPickups.length) {
      const markerDir = path.join(folder, "export", "markers");
      await fs.mkdir(markerDir, { recursive: true });
      const files = markersCore.markerFileSet("book", allPickups);
      for (const file of files) {
        await writeFileAtomic(path.join(markerDir, file.fileName), file.contents, "utf8");
      }
    }

    const reveal = path.join(outputFolder, exportCore.revealTargetInExportPack(outputFiles));
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

module.exports = {
  applyPunch,
  undoLatestPunch,
  masterWorkingFile,
  exportDeliveryPack,
  transcodeToWav,
  isWavBuffer,
};
