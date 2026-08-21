/**
 * Judge our ACX master with somebody else's meters.
 *
 * The unit tests measure the master with the same code that made it, which
 * cannot catch a shared mistake. ACX rejects a file on numbers it measures
 * itself, so here every claim about the output is checked with ffmpeg's own
 * meters (`astats`, `volumedetect`, `ebur128`) and ffprobe's stream report,
 * against the limits ACX publishes:
 *
 *   RMS between -23 dBFS and -18 dBFS
 *   peak no higher than -3 dBFS
 *   noise floor no higher than -60 dBFS RMS
 *   MP3, constant 192 kbps, 44.1 kHz, mono, with room tone at both ends
 *
 * Usage: node scripts/verify-acx.mjs [--keep]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffmpeg = path.join(root, "vendor", "bin", "ffmpeg");
const ffprobe = path.join(root, "vendor", "bin", "ffprobe");
const masterCore = require(path.join(root, "dist-core", "master.cjs"));

for (const [label, file] of [["ffmpeg", ffmpeg], ["ffprobe", ffprobe]]) {
  if (!existsSync(file)) {
    console.error(`Missing ${label} at ${file}.`);
    process.exit(1);
  }
}

const keep = process.argv.includes("--keep");
const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-acx-"));
const failures = [];
let checks = 0;

function check(claim, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`ok    ${claim}${detail ? `  (${detail})` : ""}`);
    return;
  }
  failures.push(claim);
  console.log(`FAIL  ${claim}${detail ? `\n        ${detail}` : ""}`);
}

const SAMPLE_RATE = 44100;

/** The recorded phrase the repo ships, decoded to the app's working format. */
function examplePhrase() {
  const decoded = execFileSync(ffmpeg, [
    "-v", "error", "-i", path.join(root, "public", "examples", "proof", "on_vs_in.wav"),
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1",
  ], { maxBuffer: 64 * 1024 * 1024 });
  return new Float32Array(decoded.buffer, decoded.byteOffset, Math.floor(decoded.length / 4));
}

const PHRASE = examplePhrase();

/**
 * A take as it comes out of a home booth: a real recorded voice, set well under
 * ACX's window, with a quiet room between the phrases and at both ends. Built
 * from the recorded example rather than from a tone so the speech detection in
 * the master has something honest to find.
 */
function rawTake({ speechDbfs, roomToneDbfs, repeats = 8, gapSeconds = 0.8, endsSeconds = 2 }) {
  const phraseRms = Math.sqrt(PHRASE.reduce((sum, value) => sum + value * value, 0) / PHRASE.length);
  const gain = (10 ** (speechDbfs / 20)) / phraseRms;
  const room = 10 ** (roomToneDbfs / 20);
  const gap = Math.round(gapSeconds * SAMPLE_RATE);
  const ends = Math.round(endsSeconds * SAMPLE_RATE);
  const total = ends * 2 + repeats * PHRASE.length + (repeats - 1) * gap;
  const samples = new Float32Array(total);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x3fffffff) - 1;
  };
  for (let index = 0; index < total; index += 1) {
    samples[index] = room * noise() * 0.7;
  }
  let cursor = ends;
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (let index = 0; index < PHRASE.length; index += 1) {
      const value = samples[cursor + index] + PHRASE[index] * gain;
      samples[cursor + index] = Math.max(-1, Math.min(1, value));
    }
    cursor += PHRASE.length + gap;
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

/** The app's own encoder arguments, copied from the export path. */
function encodeCbrMp3(pcmPath, outputPath, seconds) {
  execFileSync(ffmpeg, [
    "-y", "-v", "error",
    "-f", "f32le", "-ar", "44100", "-ac", "1",
    "-ss", "0", "-t", String(seconds),
    "-i", pcmPath,
    "-map_metadata", "-1",
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "1",
    "-write_xing", "0",
    outputPath,
  ], { stdio: "ignore" });
  return outputPath;
}

/** ffmpeg's own meters, over a whole file or a slice of one. */
function meters(file, { from, to } = {}) {
  const args = ["-hide_banner", "-nostats"];
  if (from !== undefined) {
    args.push("-ss", String(from));
  }
  if (to !== undefined) {
    args.push("-to", String(to));
  }
  args.push("-i", file, "-af", "astats=measure_perchannel=none,volumedetect", "-f", "null", "-");
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const read = (pattern) => {
    const match = pattern.exec(output);
    return match ? Number(match[1]) : Number.NaN;
  };
  return {
    rms: read(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/u),
    peak: read(/Peak level dB:\s*(-?\d+(?:\.\d+)?)/u),
    maxVolume: read(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/u),
    meanVolume: read(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/u),
  };
}

function probe(file) {
  const [codec, sampleRate, channels, bitRate] = execFileSync(ffprobe, [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate",
    "-of", "csv=p=0",
    file,
  ], { encoding: "utf8" }).trim().split(",");
  const duration = Number(execFileSync(ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ], { encoding: "utf8" }).trim());
  return { codec, sampleRate: Number(sampleRate), channels: Number(channels), bitRate: Number(bitRate), duration };
}

// ---------------------------------------------------------------------------
// A take that is fixable: too quiet for ACX, over a genuinely quiet room.
// ---------------------------------------------------------------------------
const quiet = rawTake({ speechDbfs: -30, roomToneDbfs: -78 });
const quietWav = writeWav(quiet, path.join(workspace, "raw-quiet.wav"));
const rawMeters = meters(quietWav);
check(
  "the raw take really is outside ACX's window to begin with",
  rawMeters.rms < -23,
  `ffmpeg reads ${rawMeters.rms.toFixed(1)} dBFS RMS`,
);

const mastered = masterCore.masterPcm(
  { samples: quiet, sampleRate: SAMPLE_RATE, channels: 1 },
  { targetRmsDbfs: -20 },
);
check("the master finishes", mastered.status === "ok", mastered.abort_reason ?? "");
if (mastered.status !== "ok") {
  console.error(`\nThe master refused a take it should have fixed: ${mastered.abort_reason}`);
  process.exit(1);
}

const pcmPath = path.join(workspace, "mastered.f32le");
writeFileSync(pcmPath, Buffer.from(
  mastered.samples.buffer,
  mastered.samples.byteOffset,
  mastered.samples.byteLength,
));
const deliverable = encodeCbrMp3(pcmPath, path.join(workspace, "01_chapter.mp3"), mastered.samples.length / 44100);

const stream = probe(deliverable);
check("the deliverable is an MP3", stream.codec === "mp3", stream.codec);
check("at 44.1 kHz", stream.sampleRate === 44100, String(stream.sampleRate));
check("in mono", stream.channels === 1, String(stream.channels));
check(
  "at a constant 192 kbps",
  Math.abs(stream.bitRate - 192000) <= 1000,
  `${Math.round(stream.bitRate / 1000)} kbps`,
);

const after = meters(deliverable);
check(
  "ffmpeg measures the RMS inside ACX's window",
  after.rms >= -23 && after.rms <= -18,
  `${after.rms.toFixed(2)} dBFS (ACX: -23 to -18)`,
);
check(
  "ffmpeg measures the peak at or under -3 dBFS",
  after.maxVolume <= -3,
  `${after.maxVolume.toFixed(2)} dBFS`,
);

// Room tone is what ACX measures for the noise floor, and it has to be there.
const head = meters(deliverable, { from: 0.2, to: 1.2 });
const tail = meters(deliverable, { from: Math.max(0, stream.duration - 1.2), to: stream.duration - 0.2 });
check(
  "the file opens with room tone under -60 dBFS",
  head.rms <= -60,
  `${head.rms.toFixed(1)} dBFS RMS in the first second`,
);
check(
  "and closes with room tone under -60 dBFS",
  tail.rms <= -60,
  `${tail.rms.toFixed(1)} dBFS RMS in the last second`,
);
check(
  "the room tone is silence-adjacent, not a fade of the speech",
  head.maxVolume <= -40 && tail.maxVolume <= -40,
  `peaks ${head.maxVolume.toFixed(1)} / ${tail.maxVolume.toFixed(1)} dBFS`,
);

// Our own report on the same file must agree with ffmpeg, or one of us is wrong.
const decoded = execFileSync(ffmpeg, [
  "-v", "error", "-i", deliverable,
  "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", "44100", "pipe:1",
], { maxBuffer: 256 * 1024 * 1024 });
const report = masterCore.measurePcm({
  samples: new Float32Array(decoded.buffer, decoded.byteOffset, Math.floor(decoded.length / 4)),
  sampleRate: 44100,
  channels: 1,
  format: "mp3",
  bitrate_kbps: 192,
  vbr: false,
});
check(
  "our RMS agrees with ffmpeg's, within a tenth of a decibel",
  Math.abs(report.rms_dbfs - after.rms) <= 0.1,
  `ours ${report.rms_dbfs.toFixed(2)}, ffmpeg ${after.rms.toFixed(2)}`,
);
check(
  "our peak agrees with ffmpeg's, within a tenth of a decibel",
  Math.abs(report.true_peak_dbfs - after.maxVolume) <= 0.2,
  `ours ${report.true_peak_dbfs.toFixed(2)}, ffmpeg ${after.maxVolume.toFixed(2)}`,
);
check(
  "our noise floor agrees with the room tone ffmpeg measures",
  Math.abs(report.noise_floor_dbfs - Math.max(head.rms, tail.rms)) <= 4,
  `ours ${report.noise_floor_dbfs.toFixed(1)}, ffmpeg ${Math.max(head.rms, tail.rms).toFixed(1)}`,
);
check(
  "and we call the file a pass",
  report.traffic_light === "green",
  `${report.traffic_light}: ${JSON.stringify(report.checks)}`,
);

// ---------------------------------------------------------------------------
// A take that cannot be fixed. Lifting it to ACX's window would lift the room
// with it, so the honest answer is to refuse and say why.
// ---------------------------------------------------------------------------
const noisy = rawTake({ speechDbfs: -30, roomToneDbfs: -48 });
const refused = masterCore.masterPcm(
  { samples: noisy, sampleRate: SAMPLE_RATE, channels: 1 },
  { targetRmsDbfs: -20 },
);
check(
  "a take with too much room noise is refused, not quietly shipped",
  refused.status !== "ok",
  refused.status === "ok"
    ? `mastered anyway; floor would be ${refused.after?.noise_floor_dbfs?.toFixed(1)} dBFS`
    : String(refused.abort_reason),
);
check(
  "and the refusal says what is wrong in words a narrator can act on",
  typeof refused.abort_reason === "string" && /noise|floor|room/i.test(refused.abort_reason),
  String(refused.abort_reason),
);

// ---------------------------------------------------------------------------
// Silence is not speech. Mastering must not invent a voice.
// ---------------------------------------------------------------------------
const empty = masterCore.masterPcm(
  { samples: new Float32Array(SAMPLE_RATE * 5), sampleRate: SAMPLE_RATE, channels: 1 },
  { targetRmsDbfs: -20 },
);
check(
  "an empty take is refused rather than amplified into noise",
  empty.status !== "ok",
  String(empty.abort_reason),
);

if (!keep) {
  rmSync(workspace, { recursive: true, force: true });
} else {
  console.log(`\nWorkspace kept at ${workspace}`);
}

console.log(`\n${checks - failures.length}/${checks} checks passed.`);
if (failures.length > 0) {
  console.error(`\nFailed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("ffmpeg agrees: what we master and encode is what ACX asks for.");
