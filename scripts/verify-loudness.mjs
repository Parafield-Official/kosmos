/**
 * Cross-check our integrated loudness meter against ffmpeg's ebur128.
 *
 * Our BS.1770-4 implementation is unit-tested against the EBU Tech 3341
 * compliance signals, which proves it agrees with the standard's own test
 * tones. This checks it against a second, independent implementation on
 * signals nobody chose for us — sines at several levels and sample rates,
 * noise, a gated signal, and real recorded speech — because two
 * implementations agreeing on arbitrary material is stronger evidence than
 * either agreeing with a fixture.
 *
 * Usage: node scripts/verify-loudness.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffmpeg = path.join(root, "vendor", "bin", "ffmpeg");
const ffprobe = path.join(root, "vendor", "bin", "ffprobe");
const corePath = path.join(root, "dist-core", "master.cjs");

if (!existsSync(ffmpeg)) {
  throw new Error("The bundled ffmpeg is missing; run npm run prepare:model first.");
}
if (!existsSync(corePath)) {
  throw new Error("dist-core is not built; run npm run build:core first.");
}
const { integratedLufs } = require(corePath);

/**
 * EBU allows ±0.1 LU between conforming meters. ffmpeg reports to one decimal,
 * so allow its rounding on top of that and nothing more.
 */
const TOLERANCE_LU = 0.15;

/** Deterministic noise, so a disagreement can be reproduced exactly. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

function sine({ frequency, dbfs, seconds, sampleRate, channels = 1 }) {
  const amplitude = 10 ** (dbfs / 20);
  const frames = Math.round(seconds * sampleRate);
  const samples = new Float32Array(frames * channels);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = amplitude * Math.sin((2 * Math.PI * frequency * frame) / sampleRate);
    for (let channel = 0; channel < channels; channel += 1) {
      samples[frame * channels + channel] = value;
    }
  }
  return { samples, sampleRate, channels };
}

function noise({ dbfs, seconds, sampleRate, seed = 7 }) {
  const amplitude = 10 ** (dbfs / 20);
  const next = random(seed);
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * next();
  }
  return { samples, sampleRate, channels: 1 };
}

/** Phrases with gaps, which is what the gating in BS.1770 exists for. */
function gatedSpeech({ sampleRate }) {
  const seconds = 20;
  const samples = new Float32Array(seconds * sampleRate);
  const next = random(11);
  for (let frame = 0; frame < samples.length; frame += 1) {
    const second = frame / sampleRate;
    const speaking = Math.floor(second) % 4 < 2;
    if (!speaking) {
      samples[frame] = 0.0002 * next();
      continue;
    }
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * second);
    samples[frame] = 0.2 * envelope * (
      Math.sin((2 * Math.PI * 180 * frame) / sampleRate)
      + 0.4 * Math.sin((2 * Math.PI * 540 * frame) / sampleRate)
      + 0.15 * next()
    );
  }
  return { samples, sampleRate, channels: 1 };
}

/**
 * A 32-bit float WAV, written here rather than with the app's own writer so
 * the file the oracle reads shares no code with the meter under test.
 */
function writeWav(file, { samples, sampleRate, channels }) {
  const dataBytes = samples.length * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20); // IEEE float
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 4, 28);
  buffer.writeUInt16LE(channels * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeFloatLE(samples[index], 44 + index * 4);
  }
  writeFileSync(file, buffer);
}

/** ffmpeg prints the integrated value in its ebur128 summary block, on stderr. */
function ffmpegLufs(file) {
  const result = spawnSync(
    ffmpeg,
    ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const summary = output.slice(output.lastIndexOf("Summary:"));
  const match = /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/u.exec(summary);
  if (!match) {
    throw new Error(`Could not read an integrated loudness from ffmpeg for ${path.basename(file)}`);
  }
  return Number(match[1]);
}

/** Decode any input to the interleaved float PCM the app measures. */
function decode(file) {
  const bytes = execFileSync(
    ffmpeg,
    ["-hide_banner", "-nostats", "-v", "error", "-i", file, "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const probed = execFileSync(
    ffprobe,
    ["-hide_banner", "-v", "error", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  ).trim().split(",");
  return {
    samples: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    sampleRate: Number(probed[0]),
    channels: Number(probed[1]),
  };
}

const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-lufs-"));
const cases = [
  { name: "sine 1 kHz, -20 dBFS, 48 kHz", audio: sine({ frequency: 1000, dbfs: -20, seconds: 12, sampleRate: 48000 }) },
  { name: "sine 1 kHz, -6 dBFS, 48 kHz", audio: sine({ frequency: 1000, dbfs: -6, seconds: 12, sampleRate: 48000 }) },
  { name: "sine 440 Hz, -30 dBFS, 44.1 kHz", audio: sine({ frequency: 440, dbfs: -30, seconds: 12, sampleRate: 44100 }) },
  { name: "sine 100 Hz, -20 dBFS, 44.1 kHz", audio: sine({ frequency: 100, dbfs: -20, seconds: 12, sampleRate: 44100 }) },
  { name: "sine 8 kHz, -20 dBFS, 48 kHz", audio: sine({ frequency: 8000, dbfs: -20, seconds: 12, sampleRate: 48000 }) },
  { name: "sine 1 kHz stereo, -20 dBFS, 48 kHz", audio: sine({ frequency: 1000, dbfs: -20, seconds: 12, sampleRate: 48000, channels: 2 }) },
  { name: "noise -24 dBFS, 48 kHz", audio: noise({ dbfs: -24, seconds: 12, sampleRate: 48000 }) },
  { name: "noise -12 dBFS, 44.1 kHz", audio: noise({ dbfs: -12, seconds: 12, sampleRate: 44100, seed: 3 }) },
  { name: "phrases with gaps, 48 kHz", audio: gatedSpeech({ sampleRate: 48000 }) },
  { name: "phrases with gaps, 44.1 kHz", audio: gatedSpeech({ sampleRate: 44100 }) },
  { name: "recorded speech (examples/proof)", source: path.join(root, "public", "examples", "proof", "on_vs_in.wav") },
];

let worst = 0;
let failures = 0;
console.log("case                                          ffmpeg      ours     delta");
for (const testCase of cases) {
  let file = testCase.source;
  if (!file) {
    file = path.join(workspace, `${testCase.name.replace(/[^a-z0-9]+/giu, "-")}.wav`);
    writeWav(file, testCase.audio);
  }
  if (!existsSync(file)) {
    console.log(`${testCase.name.padEnd(44)} skipped (no such file)`);
    continue;
  }
  const theirs = ffmpegLufs(file);
  const audio = testCase.audio ?? decode(file);
  const ours = integratedLufs(audio.samples, audio.sampleRate, audio.channels);
  const delta = ours - theirs;
  worst = Math.max(worst, Math.abs(delta));
  const outside = Math.abs(delta) > TOLERANCE_LU;
  if (outside) {
    failures += 1;
  }
  console.log(
    `${testCase.name.padEnd(44)}${theirs.toFixed(2).padStart(8)}${ours.toFixed(2).padStart(10)}`
    + `${delta.toFixed(2).padStart(10)}${outside ? "  <-- outside EBU tolerance" : ""}`,
  );
}

rmSync(workspace, { recursive: true, force: true });
console.log(`\nWorst disagreement: ${worst.toFixed(3)} LU (allowed ${TOLERANCE_LU}).`);
if (failures > 0) {
  console.error(`${failures} case${failures === 1 ? "" : "s"} disagree with ffmpeg by more than ${TOLERANCE_LU} LU.`);
  process.exit(1);
}
console.log("Our meter agrees with ffmpeg's ebur128 on every case.");
