/**
 * Cross-check deterministic repair filters on clean, clicked, and clipped
 * narration. This intentionally uses FFmpeg as the processor and independent
 * waveform measurements as the judge.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffmpeg = path.join(root, "vendor", "bin", "ffmpeg");
const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-restoration-"));
const SAMPLE_RATE = 44_100;
const REPAIR_FILTER = "adeclip=w=10:o=50:a=3:t=5:m=save,adeclick=w=10:o=50:a=1:t=8:m=save";
const failures = [];
let checks = 0;

function check(claim, condition, detail = "") {
  checks += 1;
  console.log(`${condition ? "ok  " : "FAIL"}  ${claim}${detail ? `  (${detail})` : ""}`);
  if (!condition) failures.push(claim);
}

function decode(file) {
  const bytes = execFileSync(ffmpeg, [
    "-v", "error", "-i", file,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1",
  ], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
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

function repair(input, name) {
  const output = path.join(workspace, `${name}-repaired.wav`);
  execFileSync(ffmpeg, [
    "-y", "-v", "error", "-i", input, "-af", REPAIR_FILTER,
    "-codec:a", "pcm_s16le", output,
  ]);
  return decode(output);
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

function db(value) {
  return 20 * Math.log10(Math.max(value, 1e-12));
}

function changedRatio(before, after, epsilon = 1 / 32768) {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    if (Math.abs(before[index] - after[index]) > epsilon) changed += 1;
  }
  return changed / Math.max(1, length);
}

function impulseError(samples, index) {
  return Math.abs(samples[index] - ((samples[index - 1] + samples[index + 1]) / 2));
}

function plateauSamples(samples, level) {
  const epsilon = 2 / 32768;
  return samples.reduce((count, sample) => count + (Math.abs(Math.abs(sample) - level) <= epsilon ? 1 : 0), 0);
}

try {
  const cleanPath = path.join(root, "public", "examples", "proof", "on_vs_in.wav");
  const clean = decode(cleanPath);
  const cleanRepaired = repair(cleanPath, "clean");
  check("repair preserves the clean take length", cleanRepaired.length === clean.length);
  const cleanShift = Math.abs(db(rms(cleanRepaired)) - db(rms(clean)));
  check("repair preserves clean narration level", cleanShift <= 0.1, `${cleanShift.toFixed(3)} dB shift`);
  const cleanChanges = changedRatio(clean, cleanRepaired);
  check("conservative repair leaves nearly all clean samples alone", cleanChanges <= 0.005, `${(cleanChanges * 100).toFixed(3)}% changed`);

  const clicked = new Float32Array(clean);
  const clickIndexes = [Math.floor(clicked.length * 0.28), Math.floor(clicked.length * 0.61)];
  clicked[clickIndexes[0]] = 0.98;
  clicked[clickIndexes[1]] = -0.98;
  const clickedPath = writeWav(clicked, path.join(workspace, "clicked.wav"));
  const declicked = repair(clickedPath, "clicked");
  const clickBefore = clickIndexes.map((index) => impulseError(clicked, index));
  const clickAfter = clickIndexes.map((index) => impulseError(declicked, index));
  check(
    "automatic de-click reduces both planted impulses",
    clickAfter.every((value, index) => value <= clickBefore[index] * 0.25),
    `${clickBefore.map((value) => value.toFixed(3)).join("/")} to ${clickAfter.map((value) => value.toFixed(3)).join("/")}`,
  );
  check(
    "de-click preserves clicked-take narration level",
    Math.abs(db(rms(declicked)) - db(rms(clicked))) <= 0.1,
  );

  const clipLevel = 0.95;
  const clipped = Float32Array.from(clean, (sample) => Math.max(-clipLevel, Math.min(clipLevel, sample * 1.4)));
  const clippedPath = writeWav(clipped, path.join(workspace, "clipped.wav"));
  const declipped = repair(clippedPath, "clipped");
  const beforePlateaus = plateauSamples(clipped, clipLevel);
  const afterPlateaus = plateauSamples(declipped, clipLevel);
  check("the clipping fixture contains damaged flat tops", beforePlateaus >= 20, `${beforePlateaus} samples`);
  check(
    "automatic de-clip reconstructs most flat-topped samples",
    afterPlateaus <= beforePlateaus * 0.4,
    `${beforePlateaus} to ${afterPlateaus}`,
  );
  check("de-clip returns finite audio", declipped.every(Number.isFinite));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log(`\n${checks - failures.length}/${checks} checks passed.`);
if (failures.length > 0) {
  console.error(`Failed: ${failures.join("; ")}`);
  process.exit(1);
}
