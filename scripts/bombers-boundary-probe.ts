/**
 * Cut a window out of the live narration and ask the back-check what it makes
 * of it, using the same decoder settings and the same flagging call the app
 * uses. Written to answer one question: when a slip lands on a window's first
 * word, is it lost because Whisper mishears it or because the flag has nothing
 * to its left to anchor against?
 *
 * Usage: npx jiti scripts/bombers-boundary-probe.ts <startSeconds> <endSeconds> <cursorWordIndex> [goldWordIndex]
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BOMBERS_GIRL } from "../src/core/teleprompter/bombers-girl-fixture";
import { liveBackFlag, type LiveExpectedWord, type LiveMismatch } from "../src/core/teleprompter/live";
import { promptTextTokens } from "../src/core/teleprompter/model";
import { narration, renderNarration } from "./bombers-live-run";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FFMPEG = path.join(ROOT, "vendor", "bin", "ffmpeg");
const WHISPER = path.join(ROOT, "vendor", "bin", "whisper-cli");
const MODEL = path.join(os.homedir(), "Library", "Application Support", "booth-desk", "models", "ggml-small.en.bin");
const CACHE = path.join(ROOT, ".live-run", "probe");

// The app turns whisper segments into words in the main process; borrow it so
// the probe grades the same tokens the booth would.
const { segmentWords } = createRequire(import.meta.url)(path.join(ROOT, "electron", "asr.cjs")) as {
  segmentWords: (segments: unknown[]) => Word[];
};

interface Word { text: string; start: number; end: number; confidence: number }

function expectedWords(): LiveExpectedWord[] {
  return promptTextTokens(BOMBERS_GIRL)
    .filter((token) => token.isWord)
    .map((token, index) => ({ index, lineIndex: 0, text: token.text }));
}

/** Decode a slice with the QC decoder settings from `buildWhisperArgs`. */
export function decodeWindow(wav: string, start: number, end: number): Word[] {
  mkdirSync(CACHE, { recursive: true });
  const key = createHash("sha256").update(`${wav}|${start}|${end}|bs5`).digest("hex").slice(0, 16);
  const slice = path.join(CACHE, `${key}.wav`);
  const base = path.join(CACHE, key);
  if (!existsSync(`${base}.json`)) {
    execFileSync(FFMPEG, [
      "-y", "-v", "error", "-i", wav,
      "-ss", String(start), "-to", String(end),
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", slice,
    ], { stdio: ["ignore", "ignore", "inherit"] });
    execFileSync(WHISPER, [
      "-m", MODEL, "-f", slice, "-l", "en", "-ojf", "-of", base, "-np",
      "-bs", "5", "-bo", "5", "-sow",
    ], { stdio: ["ignore", "ignore", "inherit"] });
  }
  const json = JSON.parse(readFileSync(`${base}.json`, "utf8")) as { transcription?: unknown[] };
  return segmentWords(json.transcription ?? []);
}

function flagsFor(transcript: Word[], cursor: number, gold: number): LiveMismatch[] {
  const dismissed: string[] = [];
  const flags: LiveMismatch[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const flag = liveBackFlag({
      chapterId: "bombers-girl",
      expected: expectedWords(),
      transcript,
      state: { cursor, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: gold,
      confidenceThreshold: 0.9,
      dismissedIds: dismissed,
    });
    if (!flag) {
      break;
    }
    flags.push(flag);
    dismissed.push(flag.id);
  }
  return flags;
}

function main(): void {
  const [startArg, endArg, cursorArg, goldArg] = process.argv.slice(2);
  const wav = renderNarration(narration().text);
  const start = Number(startArg);
  const end = Number(endArg);
  const cursor = Number(cursorArg);
  const gold = goldArg ? Number(goldArg) : cursor + 6;
  const transcript = decodeWindow(wav, start, end);
  const words = expectedWords();
  console.log(`window ${start}s–${end}s  cursor=${cursor} (${words[cursor]?.text}) gold=${gold}`);
  console.log(`whisper: ${transcript.map((word) => `${word.text}(${word.confidence.toFixed(2)})`).join(" ")}`);
  const flags = flagsFor(transcript, cursor, gold);
  console.log(`flags:   ${flags.length === 0 ? "none" : flags.map((flag) => `@${flag.expectedIndex} ${flag.expected}→${flag.heard} p=${flag.confidence.toFixed(2)}`).join(", ")}`);
}

main();
