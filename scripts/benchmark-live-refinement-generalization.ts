/**
 * Two additional held-out stress tests for in-app post-recording refinement:
 *   1. A real booth recording with six boundary-cutoff patterns.
 *   2. Two unseen synthetic narrators, rates, accents, and manuscripts.
 *
 * WhisperX proposes timestamps; bundled whisper.cpp independently grades the
 * exact audio isolated by those timestamps.
 *
 * Usage: npx jiti scripts/benchmark-live-refinement-generalization.ts <project-folder>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { refineLiveManuscriptTimeline } from "../src/core/proof/live-refinement";
import type { TranscriptWord } from "../src/core/proof/align";
import { preciseSelectedPlaybackRange } from "../src/core/audio/playback-range";
import { buildApproximateClock, buildCutoffCases, type CutoffCase } from "./live-refinement-stress-cases";

const require = createRequire(import.meta.url);
const { alignImportedAudioWithWhisperX } = require("../electron/whisperx.cjs") as {
  alignImportedAudioWithWhisperX: (input: Record<string, unknown>) => Promise<{ words: TranscriptWord[] }>;
};
const { transcribeAudio } = require("../electron/asr.cjs") as {
  transcribeAudio: (input: Record<string, unknown>) => Promise<{ words: TranscriptWord[] }>;
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FFMPEG = path.join(ROOT, "vendor", "bin", "ffmpeg");
const FFPROBE = path.join(ROOT, "vendor", "bin", "ffprobe");
const USER_DATA = path.join(os.homedir(), "Library", "Application Support", "booth-desk");

interface Score {
  cases: number;
  targetWords: number;
  edits: number;
  insertions: number;
  deletions: number;
  substitutions: number;
  exact: number;
}

interface ArmCase {
  start: number;
  end: number;
  expected: string[];
  label: string;
}

const SYNTHETIC_TAKES = [
  {
    id: "us-deliberate",
    voice: "Samantha",
    rate: 158,
    manuscript: "Quartz clocks tick quietly. Seven silver aircraft circle Johannesburg twice, then vanish beyond the blue ridge. Wait, wait, wait. Now the observatory doors close.",
  },
  {
    id: "uk-fast",
    voice: "Daniel",
    rate: 224,
    manuscript: "Professor Mbatha packed three crimson maps beside an extraordinarily small compass. Cedar branches scraped the skylight; rain stopped, started, and stopped again. Nobody spoke.",
  },
] as const;

async function main(): Promise<void> {
  const folder = path.resolve(process.argv[2] ?? "");
  if (!folder || folder === process.cwd()) {
    throw new Error("Pass a Kosmos project folder containing an in-app booth recording.");
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), "kosmos-refinement-generalization-"));
  try {
    const realPassed = await runRealCutoffSweep(folder, temp);
    const syntheticPassed = await runCrossVoiceSuite(temp);
    console.log("");
    if (!realPassed || !syntheticPassed) {
      process.exitCode = 2;
      console.error("GENERALIZATION GATE: REJECT");
    } else {
      console.log("GENERALIZATION GATE: PASS — both new stress tests improved paired isolation without increasing leaked words.");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function runRealCutoffSweep(folder: string, temp: string): Promise<boolean> {
  const project = JSON.parse(readFileSync(path.join(folder, "project.json"), "utf8"));
  const chapter = project.chapters?.find((entry: { live_audio_path?: string }) => entry.live_audio_path);
  if (!chapter?.live_audio_path || !chapter?.text_path || !chapter?.pickups_path) {
    throw new Error("No recorded chapter with manuscript timing was found.");
  }
  const audioPath = path.join(folder, chapter.live_audio_path);
  const document = JSON.parse(readFileSync(path.join(folder, chapter.text_path), "utf8"));
  const manuscript = document.spans.map((span: { text?: string }) => span.text ?? "").join("");
  const baseline = JSON.parse(readFileSync(path.join(folder, chapter.pickups_path), "utf8")).transcript as TranscriptWord[];
  const started = performance.now();
  const aligned = await align(audioPath);
  const runtime = (performance.now() - started) / 1000;
  const refined = refineLiveManuscriptTimeline({ manuscript, baseline, aligned });
  if (!refined.adopted) throw new Error(`Real cutoff refinement rejected at ${percent(refined.coverage)} coverage.`);

  const definitions = buildCutoffCases(Math.min(baseline.length, refined.timeline.length), 30)
    .filter((entry) => validRange(baseline, entry) && validRange(refined.timeline, entry));
  const savedCases = definitions.map((entry) => armCase(baseline, entry, true));
  const refinedCases = definitions.map((entry) => armCase(refined.timeline, entry, false, true));
  const saved = await scoreCases(audioPath, savedCases, path.join(temp, "real-saved"));
  const precise = await scoreCases(audioPath, refinedCases, path.join(temp, "real-refined"));
  const passed = improved(saved, precise);

  console.log("\nSTRESS TEST 1 — real booth cutoff sweep");
  console.log(`Cases: ${definitions.length}; patterns: ${[...new Set(definitions.map((entry) => entry.pattern))].join(", ")}; lengths: ${[...new Set(definitions.map((entry) => entry.length))].join(", ")} words`);
  printComparison(saved, precise);
  console.log(`Coverage ${percent(refined.coverage)}; refinement ${runtime.toFixed(2)}s for ${duration(audioPath).toFixed(2)}s audio; ${passed ? "PASS" : "FAIL"}`);
  return passed;
}

async function runCrossVoiceSuite(temp: string): Promise<boolean> {
  console.log("\nSTRESS TEST 2 — unseen words, accents, rates, and pauses");
  let allPassed = true;
  for (const take of SYNTHETIC_TAKES) {
    const takeRoot = path.join(temp, take.id);
    execFileSync("mkdir", ["-p", takeRoot]);
    const aiff = path.join(takeRoot, "take.aiff");
    const wav = path.join(takeRoot, "take.wav");
    execFileSync("say", ["-v", take.voice, "-r", String(take.rate), "-o", aiff, take.manuscript]);
    execFileSync(FFMPEG, ["-y", "-v", "error", "-i", aiff, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    const seconds = duration(wav);
    const baseline = buildApproximateClock(take.manuscript, seconds);
    const started = performance.now();
    const aligned = await align(wav);
    const runtime = (performance.now() - started) / 1000;
    const refined = refineLiveManuscriptTimeline({ manuscript: take.manuscript, baseline, aligned });
    if (!refined.adopted) {
      console.log(`${take.id}: rejected at ${percent(refined.coverage)} coverage — FAIL`);
      allPassed = false;
      continue;
    }
    const definitions = buildCutoffCases(baseline.length, 18)
      .filter((entry) => validRange(baseline, entry) && validRange(refined.timeline, entry));
    // Here the coarse clock is tested as recorded, without injected jitter;
    // variation comes from unseen cadence, punctuation pauses, accent, and rate.
    const coarseCases = definitions.map((entry) => armCase(baseline, entry, false));
    const preciseCases = definitions.map((entry) => armCase(refined.timeline, entry, false, true));
    const coarse = await scoreCases(wav, coarseCases, path.join(takeRoot, "coarse"));
    const precise = await scoreCases(wav, preciseCases, path.join(takeRoot, "precise"));
    const passed = improved(coarse, precise);
    allPassed = allPassed && passed;
    console.log(`${take.id}: ${take.voice} at ${take.rate} wpm, ${definitions.length} selections, ${seconds.toFixed(2)}s audio`);
    printComparison(coarse, precise);
    console.log(`Coverage ${percent(refined.coverage)}; refinement ${runtime.toFixed(2)}s; ${passed ? "PASS" : "FAIL"}`);
  }
  return allPassed;
}

function armCase(
  timeline: TranscriptWord[],
  definition: CutoffCase,
  injectCutoff: boolean,
  precisionGuard = false,
): ArmCase {
  const words = timeline.slice(definition.start, definition.start + definition.length);
  const startDelta = injectCutoff ? definition.startDelta : 0;
  const endDelta = injectCutoff ? definition.endDelta : 0;
  const rawStart = Math.max(0, words[0].start + startDelta);
  const rawEnd = Math.max(rawStart + 0.02, (words.at(-1)?.end ?? words[0].end) + endDelta);
  const range = precisionGuard
    ? preciseSelectedPlaybackRange(rawStart, rawEnd)
    : { start: rawStart, end: rawEnd };
  return {
    start: range.start,
    end: range.end,
    expected: words.map((word) => normalize(word.text)).filter(Boolean),
    label: definition.pattern,
  };
}

async function align(audioPath: string): Promise<TranscriptWord[]> {
  const result = await alignImportedAudioWithWhisperX({
    audioPath,
    userDataPath: USER_DATA,
    appPath: ROOT,
    language: "en",
  });
  return result.words;
}

async function scoreCases(audioPath: string, cases: ArmCase[], outputRoot: string): Promise<Score> {
  execFileSync("mkdir", ["-p", outputRoot]);
  const score: Score = { cases: 0, targetWords: 0, edits: 0, insertions: 0, deletions: 0, substitutions: 0, exact: 0 };
  for (const [index, entry] of cases.entries()) {
    const clip = path.join(outputRoot, `${String(index).padStart(2, "0")}-${entry.label}.wav`);
    execFileSync(FFMPEG, [
      "-y", "-v", "error", "-i", audioPath, "-ss", String(entry.start), "-to", String(entry.end),
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", clip,
    ]);
    const decoded = await transcribeAudio({
      audioPath: clip,
      userDataPath: USER_DATA,
      appPath: ROOT,
      language: "en",
      inputIsPcmWav: true,
      quality: true,
    });
    const actual = decoded.words.map((word) => normalize(word.text)).filter(Boolean);
    const edits = editCounts(entry.expected, actual);
    const total = edits.insertions + edits.deletions + edits.substitutions;
    score.cases += 1;
    score.targetWords += entry.expected.length;
    score.edits += total;
    score.insertions += edits.insertions;
    score.deletions += edits.deletions;
    score.substitutions += edits.substitutions;
    if (total === 0) score.exact += 1;
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
      const choices = [
        { ...table[i][j - 1], cost: table[i][j - 1].cost + 1, insertions: table[i][j - 1].insertions + 1 },
        { ...table[i - 1][j], cost: table[i - 1][j].cost + 1, deletions: table[i - 1][j].deletions + 1 },
        { ...table[i - 1][j - 1], cost: table[i - 1][j - 1].cost + 1, substitutions: table[i - 1][j - 1].substitutions + 1 },
      ];
      table[i][j] = choices.sort((left, right) => left.cost - right.cost || left.insertions - right.insertions)[0];
    }
  }
  const result = table[expected.length][actual.length];
  return { insertions: result.insertions, deletions: result.deletions, substitutions: result.substitutions };
}

function validRange(timeline: TranscriptWord[], entry: Pick<CutoffCase, "start" | "length">): boolean {
  const words = timeline.slice(entry.start, entry.start + entry.length);
  return words.length === entry.length && words.every((word) => word.end > word.start);
}

function duration(audioPath: string): number {
  return Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath], { encoding: "utf8" }).trim());
}

function improved(saved: Score, refined: Score): boolean {
  return refined.cases === saved.cases && wer(refined) < wer(saved) && refined.insertions <= saved.insertions;
}

function printComparison(saved: Score, refined: Score): void {
  console.log(`  WER ${percent(wer(saved))} -> ${percent(wer(refined))}; extras ${saved.insertions} -> ${refined.insertions}; missing ${saved.deletions} -> ${refined.deletions}; exact ${saved.exact}/${saved.cases} -> ${refined.exact}/${refined.cases}`);
}

function wer(score: Score): number {
  return score.targetWords > 0 ? score.edits / score.targetWords : 1;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

await main();
