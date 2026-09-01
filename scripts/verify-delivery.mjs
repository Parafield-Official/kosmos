/**
 * Exercise the two paths that unit tests cannot: FFmpeg's adaptive denoiser and
 * the non-ACX WAV encoder recipe.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffmpeg = path.join(root, "vendor", "bin", "ffmpeg");
const ffprobe = path.join(root, "vendor", "bin", "ffprobe");
const core = require(path.join(root, "dist-core", "master.cjs"));
const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-delivery-"));
const keep = process.argv.includes("--keep");
const evidenceIndex = process.argv.indexOf("--evidence-dir");
const evidenceDir = evidenceIndex === -1 ? null : path.resolve(root, process.argv[evidenceIndex + 1]);
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
const failures = [];
let checks = 0;

function check(claim, condition, detail = "") {
  checks += 1;
  console.log(`${condition ? "ok  " : "FAIL"}  ${claim}${detail ? `  (${detail})` : ""}`);
  if (!condition) failures.push(claim);
}

function decode(file, sampleRate = 44_100) {
  const bytes = execFileSync(ffmpeg, [
    "-v", "error", "-i", file,
    "-f", "f32le", "-acodec", "pcm_f32le",
    "-ac", "1", "-ar", String(sampleRate), "pipe:1",
  ], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
}

const SAMPLE_RATE = 44_100;
const phrase = decode(path.join(root, "public", "examples", "proof", "on_vs_in.wav"));

function noisyNarration(roomDbfs) {
  const phraseRms = Math.sqrt(phrase.reduce((sum, value) => sum + value * value, 0) / phrase.length);
  const voiceGain = (10 ** (-30 / 20)) / phraseRms;
  const room = 10 ** (roomDbfs / 20);
  const gap = Math.round(0.5 * SAMPLE_RATE);
  const end = Math.round(0.8 * SAMPLE_RATE);
  const samples = new Float32Array(end * 2 + phrase.length * 8 + gap * 7);
  let seed = 17;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    samples[index] = (((seed / 0xffffffff) * 2) - 1) * room;
  }
  let cursor = end;
  for (let repeat = 0; repeat < 8; repeat += 1) {
    for (let index = 0; index < phrase.length; index += 1) {
      samples[cursor + index] += phrase[index] * voiceGain;
    }
    cursor += phrase.length + gap;
  }
  return samples;
}

function writeWav(samples, file) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), 44 + index * 2);
  }
  writeFileSync(file, bytes);
  return file;
}

function windowRms(file, from, to) {
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-nostats", "-ss", String(from), "-to", String(to),
    "-i", file, "-af", "astats=measure_perchannel=none", "-f", "null", "-",
  ], { encoding: "utf8" });
  const match = /RMS level dB:\s*(-?\d+(?:\.\d+)?)/u.exec(`${result.stdout}${result.stderr}`);
  return match ? Number(match[1]) : Number.NaN;
}

function spectrogram(input, output) {
  execFileSync(ffmpeg, [
    "-y", "-v", "error", "-i", input,
    "-lavfi", "showspectrumpic=s=1200x480:legend=1:scale=log:color=rainbow",
    output,
  ]);
}

try {
  const noisy = noisyNarration(-54);
  const source = path.join(workspace, "noisy.wav");
  writeWav(noisy, source);
  const first = core.masterPcm({ samples: noisy, sampleRate: SAMPLE_RATE, channels: 1, format: "wav" });
  check("the noisy take asks for automatic cleanup", first.abort_code === "noise_floor", first.abort_reason);

  let cleanedMaster = first;
  let used = 0;
  let denoisedWav;
  for (const strength of core.noiseReductionAttempts(first.predicted_floor_dbfs, -60)) {
    used = strength;
    const filtered = execFileSync(ffmpeg, [
      "-v", "error", "-i", source,
      "-af", core.afftdnFilter(first.before.noise_floor_dbfs, strength),
      "-f", "f32le", "-acodec", "pcm_f32le",
      "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1",
    ], { maxBuffer: 256 * 1024 * 1024 });
    const samples = new Float32Array(filtered.buffer, filtered.byteOffset, Math.floor(filtered.length / 4));
    denoisedWav = writeWav(samples, path.join(workspace, "denoised.wav"));
    cleanedMaster = core.masterPcm({ samples, sampleRate: SAMPLE_RATE, channels: 1, format: "wav" });
    if (cleanedMaster.status === "ok") break;
  }
  check(
    "adaptive FFT cleanup makes the fixable take deliverable",
    cleanedMaster.status === "ok",
    `used ${used} dB; ${cleanedMaster.abort_reason ?? `floor ${cleanedMaster.after?.noise_floor_dbfs.toFixed(1)} dBFS`}`,
  );
  check("automatic cleanup never exceeds 12 dB", used <= 12, `${used} dB`);
  if (denoisedWav) {
    const beforeFloor = windowRms(source, 0, 0.7);
    const afterFloor = windowRms(denoisedWav, 0, 0.7);
    check(
      "FFmpeg independently measures a quieter room-tone window",
      afterFloor <= beforeFloor - 6,
      `${beforeFloor.toFixed(1)} to ${afterFloor.toFixed(1)} dBFS`,
    );
    const beforeVoice = windowRms(source, 1, 3.2);
    const afterVoice = windowRms(denoisedWav, 1, 3.2);
    check(
      "FFmpeg confirms narration level is preserved",
      Math.abs(afterVoice - beforeVoice) <= 0.5,
      `${beforeVoice.toFixed(1)} to ${afterVoice.toFixed(1)} dBFS`,
    );
    spectrogram(source, path.join(evidenceDir ?? workspace, "acx-noise-before.png"));
    spectrogram(denoisedWav, path.join(evidenceDir ?? workspace, "acx-noise-after.png"));
  }

  const ebu = core.resolvePreset("ebu-r128");
  const ebuProfile = core.deliveryProfile(ebu);
  const ebuMaster = core.masterPcm(
    { samples: noisyNarration(-72), sampleRate: SAMPLE_RATE, channels: 1, format: "wav" },
    { preset: ebu, profile: ebuProfile },
  );
  check("the EBU master reaches its LUFS target", ebuMaster.status === "ok" && ebuMaster.after?.checks.loudness === "pass");
  if (ebuMaster.status === "ok") {
    const pcm = path.join(workspace, "ebu.f32le");
    const wav = path.join(workspace, "ebu-r128.wav");
    writeFileSync(pcm, Buffer.from(ebuMaster.samples.buffer, ebuMaster.samples.byteOffset, ebuMaster.samples.byteLength));
    execFileSync(ffmpeg, [
      "-y", "-v", "error",
      "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", pcm,
      "-map_metadata", "-1", "-codec:a", "pcm_s24le", "-ar", "48000", "-ac", "1", wav,
    ]);
    const [codec, rate, channels, bits] = execFileSync(ffprobe, [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_raw_sample",
      "-of", "csv=p=0", wav,
    ], { encoding: "utf8" }).trim().split(",");
    check("EBU export is WAV PCM rather than ACX MP3", codec === "pcm_s24le", codec);
    check("EBU export is 48 kHz mono, 24-bit", rate === "48000" && channels === "1" && bits === "24", `${rate} Hz, ${channels} ch, ${bits} bit`);
  }
} finally {
  if (keep) {
    console.log(`Audio evidence kept at ${workspace}`);
  } else {
    rmSync(workspace, { recursive: true, force: true });
  }
}

console.log(`\n${checks - failures.length}/${checks} checks passed.`);
if (failures.length > 0) {
  console.error(`Failed: ${failures.join("; ")}`);
  process.exit(1);
}
