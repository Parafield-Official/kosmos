/**
 * Stress-test post-recording timing refinement on a real Kosmos booth tape.
 *
 * The benchmark uses WhisperX only to propose boundaries. It then cuts the
 * same manuscript selections with the saved and proposed clocks and asks the
 * bundled whisper.cpp model what each isolated clip contains. That keeps the
 * evaluator independent from the system under test.
 *
 * Usage: npx jiti scripts/benchmark-live-refinement.ts <project-folder>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { refineLiveManuscriptTimeline } from "../src/core/proof/live-refinement";
import type { TranscriptWord } from "../src/core/proof/align";

const require = createRequire(import.meta.url);
const { alignImportedAudioWithWhisperX } = require("../electron/whisperx.cjs") as {
  alignImportedAudioWithWhisperX: (input: Record<string, unknown>) => Promise<{ words: TranscriptWord[] }>;
};
const { transcribeAudio } = require("../electron/asr.cjs") as {
  transcribeAudio: (input: Record<string, unknown>) => Promise<{ words: TranscriptWord[] }>;
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FFMPEG = path.join(ROOT, "vendor", "bin", "ffmpeg");
const USER_DATA = path.join(os.homedir(), "Library", "Application Support", "booth-desk");
const APP_PATH = ROOT;
const CASE_LENGTHS = [1, 3, 6, 10];
const CASES_PER_LENGTH = 5;

interface Score {
  cases: number;
  targetWords: number;
  decodedWords: number;
  edits: number;
  insertions: number;
  deletions: number;
  substitutions: number;
  exact: number;
}

async function main(): Promise<void> {
  const folder = path.resolve(process.argv[2] ?? "");
  if (!folder || folder === process.cwd()) {
    throw new Error("Pass a Kosmos project folder.");
  }
  const project = JSON.parse(readFileSync(path.join(folder, "project.json"), "utf8"));
  const chapter = project.chapters?.find((entry: { live_audio_path?: string }) => entry.live_audio_path)
    ?? project.chapters?.[0];
  if (!chapter?.live_audio_path || !chapter?.text_path || !chapter?.pickups_path) {
    throw new Error("The project needs a saved booth tape, manuscript, and alignment.");
  }
  const audioPath = path.join(folder, chapter.live_audio_path);
  const chapterDocument = JSON.parse(readFileSync(path.join(folder, chapter.text_path), "utf8"));
  const manuscript = chapterDocument.spans.map((span: { text?: string }) => span.text ?? "").join("");
  const baselineDocument = JSON.parse(readFileSync(path.join(folder, chapter.pickups_path), "utf8"));
  const baseline = baselineDocument.transcript as TranscriptWord[];

  const refineStarted = performance.now();
  const aligned = await alignImportedAudioWithWhisperX({
    audioPath,
    userDataPath: USER_DATA,
    appPath: APP_PATH,
    language: "en",
  });
  const refinementSeconds = (performance.now() - refineStarted) / 1000;
  const refined = refineLiveManuscriptTimeline({ manuscript, baseline, aligned: aligned.words });
  if (!refined.adopted) {
    throw new Error(`Refinement rejected: ${(refined.coverage * 100).toFixed(1)}% timing coverage.`);
  }

  const selections = buildCases(Math.min(baseline.length, refined.timeline.length))
    .filter((selection) => validSelection(baseline, selection) && validSelection(refined.timeline, selection));
  const temp = mkdtempSync(path.join(os.tmpdir(), "kosmos-live-boundary-benchmark-"));
  try {
    const baselineScore = await scoreArm("saved", baseline, selections, audioPath, temp);
    const refinedScore = await scoreArm("refined", refined.timeline, selections, audioPath, temp);
    const duration = Number(execFileSync(path.join(ROOT, "vendor", "bin", "ffprobe"), [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath,
    ], { encoding: "utf8" }).trim());

    printScore("Saved in-app timing", baselineScore);
    printScore("Post-recording refinement", refinedScore);
    console.log("");
    console.log(`Coverage: ${(refined.coverage * 100).toFixed(1)}% (${refined.refinedWordCount}/${refined.baselineWordCount} words)`);
    console.log(`Refinement runtime: ${refinementSeconds.toFixed(2)}s for ${duration.toFixed(2)}s audio (${(refinementSeconds / duration).toFixed(3)}x real time)`);
    console.log(`WER change: ${percent(wer(baselineScore))} -> ${percent(wer(refinedScore))} (${signedPercent(wer(refinedScore) - wer(baselineScore))})`);
    console.log(`Extra-word change: ${baselineScore.insertions} -> ${refinedScore.insertions}`);
    console.log(`Exact-isolation change: ${percent(baselineScore.exact / baselineScore.cases)} -> ${percent(refinedScore.exact / refinedScore.cases)}`);
    if (wer(refinedScore) >= wer(baselineScore) || refinedScore.insertions > baselineScore.insertions) {
      process.exitCode = 2;
      console.error("REJECT: refinement did not improve independent isolation quality.");
    } else {
      console.log("PASS: refinement improved isolation without adding manuscript words.");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function buildCases(wordCount: number): Array<{ start: number; length: number }> {
  const cases: Array<{ start: number; length: number }> = [];
  for (const length of CASE_LENGTHS) {
    const usable = Math.max(1, wordCount - length - 2);
    for (let position = 0; position < CASES_PER_LENGTH; position += 1) {
      const start = 1 + Math.round((usable - 1) * (position / Math.max(1, CASES_PER_LENGTH - 1)));
      cases.push({ start, length });
    }
  }
  return cases;
}

function validSelection(timeline: TranscriptWord[], selection: { start: number; length: number }): boolean {
  const words = timeline.slice(selection.start, selection.start + selection.length);
  return words.length === selection.length && words.every((word) => word.end > word.start);
}

async function scoreArm(
  arm: string,
  timeline: TranscriptWord[],
  selections: Array<{ start: number; length: number }>,
  audioPath: string,
  temp: string,
): Promise<Score> {
  const score: Score = { cases: 0, targetWords: 0, decodedWords: 0, edits: 0, insertions: 0, deletions: 0, substitutions: 0, exact: 0 };
  for (const [index, selection] of selections.entries()) {
    const words = timeline.slice(selection.start, selection.start + selection.length);
    if (words.length !== selection.length || words.some((word) => word.end <= word.start)) {
      continue;
    }
    const clip = path.join(temp, `${arm}-${index}.wav`);
    execFileSync(FFMPEG, [
      "-y", "-v", "error", "-i", audioPath,
      "-ss", String(words[0].start), "-to", String(words.at(-1)?.end),
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", clip,
    ]);
    const decoded = await transcribeAudio({
      audioPath: clip,
      userDataPath: USER_DATA,
      appPath: APP_PATH,
      language: "en",
      inputIsPcmWav: true,
      quality: true,
    });
    const expectedTokens = words.map((word) => normalize(word.text)).filter(Boolean);
    const actualTokens = decoded.words.map((word) => normalize(word.text)).filter(Boolean);
    const distance = editCounts(expectedTokens, actualTokens);
    score.cases += 1;
    score.targetWords += expectedTokens.length;
    score.decodedWords += actualTokens.length;
    score.edits += distance.insertions + distance.deletions + distance.substitutions;
    score.insertions += distance.insertions;
    score.deletions += distance.deletions;
    score.substitutions += distance.substitutions;
    if (distance.insertions + distance.deletions + distance.substitutions === 0) {
      score.exact += 1;
    }
  }
  return score;
}

function editCounts(expected: string[], actual: string[]): { insertions: number; deletions: number; substitutions: number } {
  type Cell = { cost: number; insertions: number; deletions: number; substitutions: number };
  const table: Cell[][] = Array.from({ length: expected.length + 1 }, () => []);
  table[0][0] = { cost: 0, insertions: 0, deletions: 0, substitutions: 0 };
  for (let i = 1; i <= expected.length; i += 1) table[i][0] = { cost: i, insertions: 0, deletions: i, substitutions: 0 };
  for (let j = 1; j <= actual.length; j += 1) table[0][j] = { cost: j, insertions: j, deletions: 0, substitutions: 0 };
  for (let i = 1; i <= expected.length; i += 1) {
    for (let j = 1; j <= actual.length; j += 1) {
      if (expected[i - 1] === actual[j - 1]) {
        table[i][j] = { ...table[i - 1][j - 1] };
        continue;
      }
      const candidates = [
        { ...table[i][j - 1], cost: table[i][j - 1].cost + 1, insertions: table[i][j - 1].insertions + 1 },
        { ...table[i - 1][j], cost: table[i - 1][j].cost + 1, deletions: table[i - 1][j].deletions + 1 },
        { ...table[i - 1][j - 1], cost: table[i - 1][j - 1].cost + 1, substitutions: table[i - 1][j - 1].substitutions + 1 },
      ];
      table[i][j] = candidates.sort((left, right) => left.cost - right.cost || left.insertions - right.insertions)[0];
    }
  }
  const result = table[expected.length][actual.length];
  return { insertions: result.insertions, deletions: result.deletions, substitutions: result.substitutions };
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function wer(score: Score): number {
  return score.targetWords > 0 ? score.edits / score.targetWords : 1;
}

function printScore(label: string, score: Score): void {
  console.log(`${label}: ${score.cases} selections, WER ${percent(wer(score))}, exact ${score.exact}/${score.cases}, extras ${score.insertions}, missing ${score.deletions}, substitutions ${score.substitutions}`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} points`;
}

await main();
