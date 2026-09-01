/**
 * End-to-end stress benchmark for teleprompter line follow.
 *
 * Each case is spoken by a macOS virtual voice, decoded by the same bundled
 * Parakeet live model used by the desktop app, and fed to matchLiveWindow in
 * the same finalized-word batches the app receives. Generated audio stays in
 * .live-run; only the compact JSON report is kept for before/after comparison.
 *
 * Usage:
 *   npx jiti scripts/benchmark-line-follow.ts --label before
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  matchLiveWindow,
  parseParakeetLiveLine,
  type LiveExpectedWord,
  type LiveMatchState,
} from "../src/core/teleprompter/live";
import { promptTextTokens } from "../src/core/teleprompter/model";
import {
  LINE_FOLLOW_MANUSCRIPT,
  LINE_FOLLOW_STRESS_CASES,
  type LineFollowStressCase,
} from "./line-follow-stress-cases";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".live-run", "line-follow");
const REPORTS = path.join(ROOT, "docs", "benchmarks");
const FFMPEG = path.join(ROOT, "vendor", "bin", "ffmpeg");
const PARAKEET = path.join(ROOT, "vendor", "bin", "parakeet-live");
const MODEL = path.join(ROOT, "vendor", "models", "realtime_eou_120m-v1-f16.gguf");
const VOICE = process.env.LINE_FOLLOW_VOICE ?? "Daniel";
const RATE = Number(process.env.LINE_FOLLOW_RATE ?? 165);
const SILENCE_SECONDS = 1.25;

interface CursorEvent {
  heard: string;
  from: number;
  to: number;
  fromLine: number;
  toLine: number;
  haltLine?: number;
}

interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  expectation: LineFollowStressCase["expectation"];
  recognized: string;
  finalCursor: number;
  finalLine: number;
  haltedAtLine: number | null;
  backtracked: boolean;
  events: CursorEvent[];
}

function manuscriptWords(): LiveExpectedWord[] {
  let index = 0;
  return LINE_FOLLOW_MANUSCRIPT.flatMap((text, lineIndex) => (
    promptTextTokens(text)
      .filter((token) => token.isWord)
      .map((token) => ({ index: index++, lineIndex, text: token.text }))
  ));
}

function wordsThroughLine(expected: LiveExpectedWord[], lineIndex: number): number {
  const last = expected.findLastIndex((word) => word.lineIndex <= lineIndex);
  return last < 0 ? 0 : last + 1;
}

function lineAtCursor(expected: LiveExpectedWord[], cursor: number): number {
  return expected[Math.min(cursor, expected.length - 1)]?.lineIndex
    ?? LINE_FOLLOW_MANUSCRIPT.length - 1;
}

function narrationText(testCase: LineFollowStressCase): string {
  // Apple's embedded silence command makes each planned reading action sound
  // like a narrator taking a short breath before the next attempt.
  return testCase.spokenParts.join(" [[slnc 320]] ");
}

function renderNarration(testCase: LineFollowStressCase): string {
  mkdirSync(CACHE, { recursive: true });
  const text = narrationText(testCase);
  const key = createHash("sha256")
    .update(`${VOICE}|${RATE}|${text}`)
    .digest("hex")
    .slice(0, 16);
  const wav = path.join(CACHE, `${testCase.id}-${key}.wav`);
  if (existsSync(wav)) {
    return wav;
  }
  const aiff = path.join(CACHE, `${testCase.id}-${key}.aiff`);
  execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", aiff, text], { stdio: "ignore" });
  execFileSync(FFMPEG, [
    "-y", "-v", "error", "-i", aiff,
    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav,
  ], { stdio: "ignore" });
  return wav;
}

function recognize(wav: string): string[] {
  const pcm = execFileSync(FFMPEG, [
    "-v", "error", "-i", wav, "-ar", "16000", "-ac", "1", "-f", "f32le", "-",
  ], { maxBuffer: 64 * 1024 * 1024 });
  const tail = Buffer.alloc(Math.floor(16_000 * SILENCE_SECONDS) * Float32Array.BYTES_PER_ELEMENT);
  const result = spawnSync(PARAKEET, [MODEL], {
    cwd: path.dirname(PARAKEET),
    env: { ...process.env, DYLD_LIBRARY_PATH: path.dirname(PARAKEET) },
    input: Buffer.concat([pcm, tail]),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 120_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Parakeet exited with status ${result.status}`);
  }
  return result.stdout.toString("utf8").split("\n").filter(Boolean);
}

function runCase(testCase: LineFollowStressCase, expected: LiveExpectedWord[]): CaseResult {
  const wav = renderNarration(testCase);
  const lines = recognize(wav);
  let state: LiveMatchState = { cursor: 0, lastHeardEnd: 0 };
  const events: CursorEvent[] = [];
  const recognized: string[] = [];
  let haltedAtLine: number | null = null;
  let backtracked = false;

  for (const line of lines) {
    const words = parseParakeetLiveLine(line);
    if (words.length === 0) {
      continue;
    }
    recognized.push(...words.map((word) => word.text));
    const before = state.cursor;
    const result = matchLiveWindow({
      chapterId: "line-follow-stress",
      expected,
      transcript: words,
      state,
      flagsEnabled: false,
      confidenceThreshold: 0.9,
      haltOnMismatch: true,
    });
    state = result.state;
    // A halt deliberately rewinds to the first word of the mismatch run. That
    // is a stop, not evidence that the follower tracked a narrator's reread.
    if (state.cursor < before && !result.halt) {
      backtracked = true;
    }
    if (state.cursor !== before || result.halt) {
      events.push({
        heard: words.map((word) => word.text).join(" "),
        from: before,
        to: state.cursor,
        fromLine: lineAtCursor(expected, before),
        toLine: lineAtCursor(expected, state.cursor),
        ...(result.halt ? { haltLine: result.halt.lineIndex } : {}),
      });
    }
    if (result.halt) {
      haltedAtLine = result.halt.lineIndex;
      break;
    }
  }

  const expectation = testCase.expectation;
  const passed = expectation.kind === "halt"
    ? haltedAtLine === expectation.atLine
    : haltedAtLine === null
      && state.cursor >= wordsThroughLine(expected, expectation.throughLine)
      && (!expectation.mustBacktrack || backtracked);

  return {
    id: testCase.id,
    description: testCase.description,
    passed,
    expectation,
    recognized: recognized.join(" "),
    finalCursor: state.cursor,
    finalLine: lineAtCursor(expected, state.cursor),
    haltedAtLine,
    backtracked,
    events,
  };
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const label = (option("--label") ?? "run").replace(/[^a-z0-9_-]/giu, "-");
  const expected = manuscriptWords();
  const results: CaseResult[] = [];
  for (const [index, testCase] of LINE_FOLLOW_STRESS_CASES.entries()) {
    process.stdout.write(`[${index + 1}/${LINE_FOLLOW_STRESS_CASES.length}] ${testCase.id} ... `);
    const result = runCase(testCase, expected);
    results.push(result);
    console.log(result.passed ? "PASS" : "FAIL");
  }
  const passed = results.filter((result) => result.passed).length;
  const report = {
    schema: 1,
    label,
    createdAt: new Date().toISOString(),
    voice: VOICE,
    rate: RATE,
    recognizer: "bundled parakeet-live realtime_eou_120m-v1-f16.gguf",
    matcher: "matchLiveWindow with haltOnMismatch=true",
    summary: {
      passed,
      total: results.length,
      rate: Number((passed / results.length).toFixed(4)),
    },
    results,
  };
  mkdirSync(REPORTS, { recursive: true });
  const reportPath = path.join(REPORTS, `line-follow-${label}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${passed}/${results.length} passed (${(100 * passed / results.length).toFixed(1)}%)`);
  for (const result of results.filter((candidate) => !candidate.passed)) {
    console.log(`  FAIL ${result.id}: cursor=${result.finalCursor}, halt=${result.haltedAtLine ?? "none"}, backtracked=${result.backtracked}`);
  }
  console.log(`report: ${reportPath}`);
}

main();
