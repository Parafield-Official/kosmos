/**
 * Score the batch proof pass on real speech, not on hand-written transcripts.
 *
 * `src/core/proof/eval.test.ts` scores the aligner against a corpus we wrote,
 * which proves the diff behaves as designed but not that it survives a real
 * recogniser's output — its timings, its confidences, its own spelling of what
 * it heard. Here every take is spoken by a synthetic narrator, converted and
 * decoded with the exact binaries and arguments the app uses, and the pickups
 * are scored against the slips that were planted on purpose.
 *
 * A planted slip that produces no pickup is a miss. A pickup on a word nobody
 * misread is a false alarm — the thing that makes a proofing tool unusable.
 *
 * Usage: npx jiti scripts/verify-proof.ts [--only <id>] [--keep]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { alignTranscript, type TranscriptWord } from "../src/core/proof/align";
import { findSilences, type SilenceRange } from "../src/core/proof/silence";
import type { Pickup } from "../src/core/project/types";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffmpeg = path.join(root, "vendor", "bin", "ffmpeg");
const whisper = path.join(root, "vendor", "bin", "whisper-cli");
const modelPath = path.join(os.homedir(), "Library", "Application Support", "booth-desk", "models", "ggml-small.en.bin");
const { segmentWords } = require("../electron/asr.cjs") as { segmentWords: (segments: unknown[]) => TranscriptWord[] };

interface Slip {
  /** The manuscript word that was misread, or "" for an inserted word. */
  expected: string;
  /** What the narrator said instead, or "" for a skipped word. */
  heard?: string;
  kind: Pickup["kind"];
}

interface Case {
  id: string;
  /** What is written. */
  manuscript: string;
  /** What the narrator says, fed to the speech synthesiser. */
  spoken: string;
  /** Deliberate slips. An empty list means a clean read. */
  slips: Slip[];
  /** macOS voice, so takes differ in accent and pace. */
  voice: string;
  /** Word to drop a silence after, for the long-pause check. */
  pauseAfterWord?: string;
  note: string;
}

const CASES: Case[] = [
  {
    id: "clean-read",
    manuscript: "The lamp on the table burned low, and the room smelled of rain and old paper.",
    spoken: "The lamp on the table burned low, and the room smelled of rain and old paper.",
    slips: [],
    voice: "Samantha",
    note: "A clean read must produce nothing at all.",
  },
  {
    id: "misread-word",
    manuscript: "She waited by the harbour until the last of the light had gone.",
    spoken: "She waited by the harbour until the last of the night had gone.",
    slips: [{ expected: "light", heard: "night", kind: "sub" }],
    voice: "Samantha",
    note: "One word swapped for another that sounds close.",
  },
  {
    id: "skipped-word",
    manuscript: "He carried the heavy black case up four flights of stairs.",
    spoken: "He carried the black case up four flights of stairs.",
    slips: [{ expected: "heavy", heard: "", kind: "skip" }],
    voice: "Daniel",
    note: "A dropped adjective, the commonest narrator slip.",
  },
  {
    id: "added-word",
    manuscript: "They left the door open behind them.",
    spoken: "They left the front door open behind them.",
    slips: [{ expected: "", heard: "front", kind: "insert" }],
    voice: "Daniel",
    note: "A word the narrator added that is not in the script.",
  },
  {
    id: "number-said-as-words",
    manuscript: "In 1999 the mill closed, and 27 families left the valley.",
    spoken: "In nineteen ninety-nine the mill closed, and twenty-seven families left the valley.",
    slips: [],
    voice: "Samantha",
    note: "Figures read aloud the normal way must not be flagged.",
  },
  {
    id: "number-said-wrong",
    manuscript: "The lease ran for 14 years from the spring of 1971.",
    spoken: "The lease ran for forty years from the spring of nineteen seventy-one.",
    slips: [{ expected: "14", heard: "forty", kind: "sub" }],
    voice: "Samantha",
    note: "A genuinely wrong figure still has to be caught.",
  },
  {
    id: "hyphenated-compound",
    manuscript: "The half-empty carriage rattled through the twenty-first mile.",
    spoken: "The half-empty carriage rattled through the twenty-first mile.",
    slips: [],
    voice: "Karen",
    note: "Hyphenated compounds are one written word and two spoken ones.",
  },
  {
    id: "homophone",
    manuscript: "They took their coats and left them there by the door.",
    spoken: "They took their coats and left them there by the door.",
    slips: [],
    voice: "Karen",
    note: "The recogniser picks one of their/there/they're; we must not care.",
  },
  {
    id: "long-pause",
    manuscript: "He looked at the letter and then he read it aloud.",
    spoken: "He looked at the letter and then he read it aloud.",
    slips: [{ expected: "", heard: "", kind: "pause" }],
    pauseAfterWord: "letter",
    voice: "Samantha",
    note: "A silence past the 4s default is found in the audio, not in the transcript's timings.",
  },
  {
    id: "two-slips",
    manuscript: "The captain signalled the harbour master and waited for the tide.",
    spoken: "The captain signalled the harbour mister and waited for the wind.",
    slips: [
      { expected: "master", heard: "mister", kind: "sub" },
      { expected: "tide", heard: "wind", kind: "sub" },
    ],
    voice: "Daniel",
    note: "Two slips in one take, so one finding cannot mask the other.",
  },
];

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const keep = args.includes("--keep");

for (const [label, file] of [["ffmpeg", ffmpeg], ["whisper-cli", whisper], ["speech model", modelPath]] as const) {
  if (!existsSync(file)) {
    console.error(`Missing ${label} at ${file}. Run npm run prepare:model first.`);
    process.exit(1);
  }
}

const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-proof-"));

/** Speak a take, with an optional silence dropped in mid-sentence. */
function narrate(testCase: Case, index: number): string {
  const base = path.join(workspace, `${String(index).padStart(2, "0")}_${testCase.id}`);
  const wav = `${base}.wav`;
  if (!testCase.pauseAfterWord) {
    speak(testCase.spoken, testCase.voice, `${base}.aiff`);
    convert(`${base}.aiff`, wav);
    return wav;
  }
  const marker = `${testCase.pauseAfterWord} `;
  const split = testCase.spoken.indexOf(marker) + marker.length;
  speak(testCase.spoken.slice(0, split), testCase.voice, `${base}_a.aiff`);
  speak(testCase.spoken.slice(split), testCase.voice, `${base}_b.aiff`);
  convert(`${base}_a.aiff`, `${base}_a.wav`);
  convert(`${base}_b.aiff`, `${base}_b.wav`);
  const list = path.join(workspace, `${testCase.id}.txt`);
  const silence = path.join(workspace, "silence.wav");
  // Past the app's 4s default, so this is a pause a narrator would want flagged.
  execFileSync(ffmpeg, [
    "-y", "-v", "error",
    "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "/dev/zero",
    "-t", "5.5", "-c:a", "pcm_s16le", silence,
  ], { stdio: "ignore" });
  require("node:fs").writeFileSync(
    list,
    [`${base}_a.wav`, silence, `${base}_b.wav`].map((file) => `file '${file}'`).join("\n"),
  );
  execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", wav], { stdio: "ignore" });
  return wav;
}

function speak(text: string, voice: string, output: string): void {
  execFileSync("say", ["-v", voice, "-o", output, text], { stdio: "ignore" });
}

/** The app's own conversion arguments, so whisper sees what it sees in the app. */
function convert(input: string, output: string): void {
  execFileSync(ffmpeg, [
    "-y", "-v", "error", "-i", input,
    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output,
  ], { stdio: "ignore" });
}

function transcribe(wav: string): TranscriptWord[] {
  const base = `${wav}.transcript`;
  execFileSync(whisper, ["-m", modelPath, "-f", wav, "-l", "en", "-ojf", "-of", base, "-np"], { stdio: "ignore" });
  const json = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  return segmentWords(json.transcription ?? []);
}

/**
 * Measure the quiet stretches the way the app does: decode to mono with the
 * bundled ffmpeg, then read the levels. The recogniser's own word timings are
 * an even division of each segment and cannot be trusted for this.
 */
function silences(wav: string): SilenceRange[] {
  const rate = 8000;
  const pcm = execFileSync(ffmpeg, [
    "-v", "error", "-i", wav,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", String(rate), "pipe:1",
  ], { maxBuffer: 512 * 1024 * 1024 });
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  return findSilences(samples, rate, 1);
}

function duration(wav: string): number {
  const output = execFileSync(
    path.join(root, "vendor", "bin", "ffprobe"),
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
    { encoding: "utf8" },
  );
  return Number(output.trim());
}

function plain(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, " ").trim();
}

/** A pickup answers a slip when it names the same word, or is the same silence. */
function matches(pickup: Pickup, slip: Slip): boolean {
  if (slip.kind === "pause") {
    return pickup.kind === "pause";
  }
  const expected = plain(slip.expected);
  const heard = plain(slip.heard ?? "");
  if (expected.length > 0 && plain(pickup.expected).split(" ").includes(expected)) {
    return true;
  }
  return heard.length > 0 && plain(pickup.heard).split(" ").includes(heard);
}

const selected = only ? CASES.filter((testCase) => testCase.id === only) : CASES;
let found = 0;
let planted = 0;
let falseAlarms = 0;
const failures: string[] = [];

console.log(`Speaking and decoding ${selected.length} takes with the bundled whisper build.\n`);

selected.forEach((testCase, index) => {
  const wav = narrate(testCase, index);
  const transcript = transcribe(wav);
  const result = alignTranscript({
    chapterId: "ch01",
    manuscript: testCase.manuscript,
    transcript,
    durationSeconds: duration(wav),
    minConfidence: 0.35,
    silences: silences(wav),
  });
  const pickups = result.pickups;
  const unmatchedSlips = testCase.slips.filter((slip) => !pickups.some((pickup) => matches(pickup, slip)));
  const spurious = pickups.filter((pickup) => !testCase.slips.some((slip) => matches(pickup, slip)));

  planted += testCase.slips.length;
  found += testCase.slips.length - unmatchedSlips.length;
  falseAlarms += spurious.length;

  const ok = unmatchedSlips.length === 0 && spurious.length === 0;
  if (!ok) {
    failures.push(testCase.id);
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${testCase.id} — ${testCase.note}`);
  console.log(`        heard: ${transcript.map((word) => word.text).join(" ")}`);
  if (pickups.length > 0) {
    for (const pickup of pickups) {
      const label = pickup.kind === "pause"
        ? `${(pickup.t_end - pickup.t_start).toFixed(1)}s silence`
        : `${pickup.expected || "—"} → ${pickup.heard || "—"}`;
      console.log(`        flagged: ${label} [${pickup.kind}] at ${pickup.t_start.toFixed(2)}s`);
    }
  }
  for (const slip of unmatchedSlips) {
    console.log(`        MISSED: ${slip.expected || "(inserted)"} → ${slip.heard ?? ""} [${slip.kind}]`);
  }
  for (const pickup of spurious) {
    console.log(`        FALSE ALARM: ${pickup.expected || "—"} → ${pickup.heard || "—"} [${pickup.kind}]`);
  }
  console.log("");
});

if (!keep) {
  rmSync(workspace, { recursive: true, force: true });
}

const recall = planted === 0 ? 1 : found / planted;
const precision = found + falseAlarms === 0 ? 1 : found / (found + falseAlarms);
console.log(`Planted slips found: ${found}/${planted} (recall ${recall.toFixed(2)})`);
console.log(`False alarms: ${falseAlarms} (precision ${precision.toFixed(2)})`);
if (failures.length > 0) {
  console.error(`\nTakes that did not score clean: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nEvery planted slip was caught, and nothing else was flagged.");
