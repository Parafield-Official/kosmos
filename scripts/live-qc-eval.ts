/**
 * End-to-end evaluation of the live Whisper back-check on held-out narration.
 *
 * Each case is spoken by a synthetic narrator (`say`), converted with the
 * bundled ffmpeg, and decoded by the bundled whisper-cli using the exact
 * arguments the desktop app uses for QC. The resulting words go through
 * `liveBackFlag` the same way `transcribeWhisperQc` calls it, so the score
 * reflects what a narrator would actually see in the booth.
 *
 * Usage:
 *   npx jiti scripts/live-qc-eval.ts [--set dev|lockbox|all] [--only <id>]
 *                                    [--fresh] [--write-fixtures]
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { liveBackFlag, numberValue, LIVE_QC_PHRASE_WORDS, type LiveExpectedWord, type LiveMismatch, type LiveTranscriptWord } from "../src/core/teleprompter/live";
import { promptTextTokens } from "../src/core/teleprompter/model";
import { CASES, PASSAGES, type QcCase } from "./live-qc-corpus";

const require = createRequire(import.meta.url);
const { segmentWords } = require("../electron/asr.cjs") as {
  segmentWords: (segments: unknown[]) => LiveTranscriptWord[];
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE_DIR = path.join(ROOT, ".qc-eval-cache");
const FIXTURE_PATH = path.join(ROOT, "testdata", "live-qc", "held-out.json");
const FFMPEG = path.join(ROOT, "vendor", "bin", "ffmpeg");
const WHISPER = path.join(ROOT, "vendor", "bin", "whisper-cli");
const MODEL = process.env.WHISPER_MODEL_PATH
  ?? path.join(os.homedir(), "Library", "Application Support", "booth-desk", "models", "ggml-small.en.bin");
const THREADS = Math.min(6, Math.max(2, os.cpus().length));

interface CaseTake {
  id: string;
  spoken: string;
  words: LiveTranscriptWord[];
}

interface CaseScore {
  id: string;
  set: QcCase["set"];
  klass: QcCase["klass"];
  voice: string;
  passage: string;
  expectedWord: string;
  intendedHeard: string;
  spoken: string;
  transcript: string;
  detected: boolean;
  heardMatched: boolean;
  whisperHeardSlip: boolean;
  flags: Array<{ expected: string; heard: string; expectedIndex: number; confidence: number }>;
  falsePositives: Array<{ expected: string; heard: string; expectedIndex: number; confidence: number }>;
}

function passageWords(text: string): LiveExpectedWord[] {
  return promptTextTokens(text)
    .filter((token) => token.isWord)
    .map((token, index) => ({ index, lineIndex: 0, text: token.text }));
}

function normalize(text: string): string {
  return text.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}

function phraseStart(expected: LiveExpectedWord[], phrase: string): number {
  const needles = promptTextTokens(phrase).filter((token) => token.isWord).map((token) => normalize(token.text));
  for (let start = 0; start <= expected.length - needles.length; start += 1) {
    if (needles.every((needle, offset) => normalize(expected[start + offset]?.text ?? "") === needle)) {
      return start;
    }
  }
  throw new Error(`phrase not found in passage: ${phrase}`);
}

/**
 * What the narrator actually says: the manuscript phrase with one slip, optionally
 * preceded by `lead` words of run-up. The run-up is the pre-roll a QC window
 * should carry, so a boundary that lands mid-word eats context instead of a word
 * under judgement.
 */
function spokenText(entry: QcCase, expected: LiveExpectedWord[], start: number, lead = 0): string {
  const count = promptTextTokens(entry.phrase).filter((token) => token.isWord).length;
  if (entry.offset >= LIVE_QC_PHRASE_WORDS) {
    // Production grades one phrase at a time; a later word belongs to the next
    // QC window, so such a case would score as a miss for the wrong reason.
    throw new Error(`${entry.id}: slip offset ${entry.offset} falls outside the graded phrase`);
  }
  assertIntendedTarget(entry, expected, start);
  const words: string[] = [];
  for (let offset = leadStart(start, lead) - start; offset < 0; offset += 1) {
    words.push(expected[start + offset]?.text ?? "");
  }
  for (let offset = 0; offset < count; offset += 1) {
    const word = expected[start + offset]?.text ?? "";
    if (offset === entry.offset) {
      if (entry.heard) {
        words.push(entry.heard);
      }
      continue;
    }
    words.push(word);
  }
  return `${words.join(" ")}.`;
}

/** Manuscript index the spoken audio begins at once pre-roll is included. */
function leadStart(start: number, lead: number): number {
  return Math.max(0, start - Math.max(0, lead));
}

/**
 * A hyphenated manuscript word tokenizes into several words, so an offset aimed
 * at `forty-six` silently lands on one component. Breaking the wrong one narrates
 * as "six fifty six", which no narrator says and which Whisper renders as a digit
 * string — scoring as a miss and a false positive at once. Offsets inside a
 * compound therefore have to name the component they mean.
 */
function assertIntendedTarget(entry: QcCase, expected: LiveExpectedWord[], start: number): void {
  if (entry.offset < 0) {
    return;
  }
  let consumed = 0;
  for (const raw of entry.phrase.split(/\s+/u).filter(Boolean)) {
    const parts = promptTextTokens(raw).filter((token) => token.isWord).length;
    if (entry.offset >= consumed + parts) {
      consumed += parts;
      continue;
    }
    const target = normalize(expected[start + entry.offset]?.text ?? "");
    if (parts > 1 && !entry.expects) {
      throw new Error(
        `${entry.id}: offset ${entry.offset} points inside the compound "${raw}"`
        + ` (at "${target}"); set expects to say which component is meant`,
      );
    }
    if (entry.expects && normalize(entry.expects) !== target) {
      throw new Error(`${entry.id}: expects "${entry.expects}" but offset ${entry.offset} is "${target}"`);
    }
    return;
  }
}

/**
 * Does telling Whisper what to expect help? `phrase` passes the manuscript
 * words for this QC window as the initial prompt; `names` passes only the
 * passage's proper nouns, which is the version that cannot spell out the word
 * under judgement. `none` is what the app ships today.
 */
export type PromptMode = "none" | "phrase" | "names";

function promptFor(mode: PromptMode, passageText: string, phrase: string): string {
  if (mode === "phrase") {
    return phrase;
  }
  if (mode === "names") {
    const names = new Set<string>();
    const tokens = promptTextTokens(passageText).filter((token) => token.isWord).map((token) => token.text);
    tokens.forEach((token, index) => {
      const previous = tokens[index - 1] ?? "";
      const startsSentence = index === 0 || /[.!?]$/u.test(previous);
      if (!startsSentence && /^\p{Lu}/u.test(token)) {
        names.add(token);
      }
    });
    return [...names].join(", ");
  }
  return "";
}

/**
 * The booth, not the studio. `booth` adds low-frequency rumble and a hiss
 * floor; `quiet` is a narrator sitting too far back with the same hiss. Pristine
 * synthesis cannot show whether conditioning earns its keep.
 */
export type Degrade = "none" | "booth" | "quiet";
/** Conditioning applied before the encoder sees the audio. */
export type Condition = "none" | "hp" | "norm" | "both";

interface TakeOptions {
  prompt: string;
  degrade: Degrade;
  condition: Condition;
  suppressNst: boolean;
  /** Milliseconds sliced off the head/tail, simulating a window boundary that lands mid-word. */
  trimHead?: number;
  trimTail?: number;
}

function trimGraph(options: TakeOptions): string {
  const stages = [
    options.trimHead ? `atrim=start=${(options.trimHead / 1000).toFixed(3)},asetpts=N/SR/TB` : "",
    options.trimTail ? `areverse,atrim=start=${(options.trimTail / 1000).toFixed(3)},asetpts=N/SR/TB,areverse` : "",
  ].filter(Boolean);
  return stages.length > 0 ? stages.join(",") : "anull";
}

function conditionChain(condition: Condition): string {
  const stages = [
    condition === "hp" || condition === "both" ? "highpass=f=80" : "",
    condition === "norm" || condition === "both" ? "loudnorm=I=-19:TP=-3:LRA=7" : "",
  ].filter(Boolean);
  return stages.length > 0 ? stages.join(",") : "anull";
}

/**
 * The vendored ffmpeg is built without the lavfi input device, so noise is
 * generated by source filters inside the graph rather than as extra inputs.
 */
export function degradeGraph(degrade: Degrade): string {
  const rumble = "anoisesrc=c=brown:r=16000:a=0.6,lowpass=f=110[rumble]";
  const hiss = (amplitude: number) => `anoisesrc=c=white:r=16000:a=${amplitude}[hiss]`;
  if (degrade === "booth") {
    return `${rumble};${hiss(0.004)};[0:a][rumble][hiss]amix=inputs=3:duration=first:normalize=0[dirty]`;
  }
  if (degrade === "quiet") {
    return `${hiss(0.004)};[0:a]volume=0.12[soft];[soft][hiss]amix=inputs=2:duration=first:normalize=0[dirty]`;
  }
  return "[0:a]anull[dirty]";
}

function filterArgs(input: string, output: string, options: TakeOptions): string[] {
  return [
    "-y", "-v", "error", "-i", input,
    "-filter_complex",
    `${degradeGraph(options.degrade)};[dirty]${conditionChain(options.condition)},${trimGraph(options)}[out]`,
    "-map", "[out]", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output,
  ];
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** The spoken audio is cached once; each arm only re-filters and re-decodes. */
function baseWav(entry: QcCase, spoken: string, fresh: boolean): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  const key = digest(`${entry.voice}|${entry.rate}|${spoken}`);
  const wav = path.join(CACHE_DIR, `${key}.base.wav`);
  if (!fresh && existsSync(wav)) {
    return wav;
  }
  const aiff = path.join(CACHE_DIR, `${key}.aiff`);
  execFileSync("say", ["-v", entry.voice, "-r", String(entry.rate), "-o", aiff, spoken], { stdio: "inherit" });
  execFileSync(FFMPEG, ["-y", "-v", "error", "-i", aiff, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { stdio: "inherit" });
  return wav;
}

function renderTake(entry: QcCase, spoken: string, fresh: boolean, options: TakeOptions): LiveTranscriptWord[] {
  const source = baseWav(entry, spoken, fresh);
  const trims = [
    options.trimHead ? `head:${options.trimHead}` : "",
    options.trimTail ? `tail:${options.trimTail}` : "",
  ].filter(Boolean).join("|");
  const key = digest(
    `${source}|${options.degrade}|${options.condition}|${options.prompt}|${options.suppressNst}`
    + `${trims ? `|${trims}` : ""}|bs5|small.en`,
  );
  const wordsPath = path.join(CACHE_DIR, `${key}.words.json`);
  if (!fresh && existsSync(wordsPath)) {
    return JSON.parse(readFileSync(wordsPath, "utf8")) as LiveTranscriptWord[];
  }
  const wav = path.join(CACHE_DIR, `${key}.wav`);
  const base = path.join(CACHE_DIR, key);
  execFileSync(FFMPEG, filterArgs(source, wav, options), { stdio: ["ignore", "ignore", "inherit"] });
  execFileSync(WHISPER, [
    "-m", MODEL,
    "-f", wav,
    "-l", "en",
    "-ojf",
    "-of", base,
    "-np",
    "-t", String(THREADS),
    "-bs", "5",
    "-bo", "5",
    "-sow",
    ...(options.suppressNst ? ["-sns"] : []),
    ...(options.prompt ? ["--prompt", options.prompt] : []),
  ], { stdio: ["ignore", "ignore", "inherit"] });
  const json = JSON.parse(readFileSync(`${base}.json`, "utf8")) as { transcription?: unknown[] };
  const words = segmentWords(json.transcription ?? []);
  writeFileSync(wordsPath, JSON.stringify(words, null, 2));
  return words;
}

/**
 * Mirror `transcribeWhisperQc`: grade the frozen window against the gold
 * checkpoint captured when the phrase was drained, and walk it up to three
 * times so one slip cannot hide the next.
 */
export function flagsForTake(
  expected: LiveExpectedWord[],
  transcript: LiveTranscriptWord[],
  cursor: number,
  goldCursor: number,
): LiveMismatch[] {
  const dismissed: string[] = [];
  const flags: LiveMismatch[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const flag = liveBackFlag({
      chapterId: "held-out",
      expected,
      transcript,
      state: { cursor, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor,
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

/**
 * Which flag positions count as finding this slip. Normally exactly one, but a
 * spoken number spans several manuscript words and Whisper renders the whole run
 * as one digit string (`six forty-six` → `646`), so the pickup can only land
 * somewhere inside the run. Anywhere in the run puts the narrator's eye on the
 * number they misread, which is what the flag is for.
 */
function acceptedIndices(entry: QcCase, expected: LiveExpectedWord[], target: number): Set<number> {
  if (target < 0) {
    return new Set();
  }
  if (entry.klass !== "number") {
    return new Set([target]);
  }
  const isNumberWord = (index: number): boolean => {
    const text = expected[index]?.text;
    return Boolean(text) && numberValue(normalize(text ?? "")) != null;
  };
  const run = new Set([target]);
  for (let index = target - 1; index >= 0 && isNumberWord(index); index -= 1) {
    run.add(index);
  }
  for (let index = target + 1; index < expected.length && isNumberWord(index); index += 1) {
    run.add(index);
  }
  return run;
}

export function scoreTake(entry: QcCase, take: CaseTake, lead = 0): CaseScore {
  const passage = PASSAGES.find((candidate) => candidate.id === entry.passage);
  if (!passage) {
    throw new Error(`unknown passage: ${entry.passage}`);
  }
  const expected = passageWords(passage.text);
  const start = phraseStart(expected, entry.phrase);
  const target = entry.offset >= 0 ? start + entry.offset : -1;
  const gold = start + LIVE_QC_PHRASE_WORDS;
  // The window opens where its audio opens. Pre-roll words stay outside the
  // flaggable range, so they add anchors without adding verdicts.
  const flags = flagsForTake(expected, take.words, leadStart(start, lead), gold);
  const accepted = acceptedIndices(entry, expected, target);
  const hit = flags.find((flag) => accepted.has(flag.expectedIndex));
  const transcript = take.words.map((word) => word.text).join(" ");
  const shape = (flag: LiveMismatch) => ({
    expected: flag.expected,
    heard: flag.heard,
    expectedIndex: flag.expectedIndex,
    confidence: Number(flag.confidence.toFixed(3)),
  });
  return {
    id: entry.id,
    set: entry.set,
    klass: entry.klass,
    voice: entry.voice,
    passage: entry.passage,
    expectedWord: target >= 0 ? expected[target]?.text ?? "" : "",
    intendedHeard: entry.heard,
    spoken: take.spoken,
    transcript,
    detected: Boolean(hit),
    heardMatched: Boolean(hit && entry.heard && normalize(hit.heard) === normalize(entry.heard)),
    whisperHeardSlip: entry.heard
      ? take.words.some((word) => normalize(word.text) === normalize(entry.heard))
      : false,
    flags: flags.map(shape),
    falsePositives: flags.filter((flag) => !accepted.has(flag.expectedIndex)).map(shape),
  };
}

function flagValue(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const setArg = (flagValue(argv, "--set") ?? "all") as QcCase["set"] | "all";
  const only = flagValue(argv, "--only");
  const fresh = argv.includes("--fresh");
  const selected = CASES.filter((entry) => (setArg === "all" || entry.set === setArg) && (!only || entry.id === only));
  if (selected.length === 0) {
    throw new Error("no cases selected");
  }
  if (!existsSync(MODEL)) {
    throw new Error(`Whisper model not found at ${MODEL}`);
  }

  const promptMode = (flagValue(argv, "--prompt-mode") ?? "none") as PromptMode;
  const degrade = (flagValue(argv, "--degrade") ?? "none") as Degrade;
  const condition = (flagValue(argv, "--condition") ?? "none") as Condition;
  const suppressNst = argv.includes("--suppress-nst");
  const trimHead = Number(flagValue(argv, "--trim-head") ?? 0);
  const trimTail = Number(flagValue(argv, "--trim-tail") ?? 0);
  const lead = Number(flagValue(argv, "--lead-words") ?? 0);
  const scores: CaseScore[] = [];
  for (const entry of selected) {
    const passage = PASSAGES.find((candidate) => candidate.id === entry.passage);
    if (!passage) {
      throw new Error(`unknown passage: ${entry.passage}`);
    }
    const expected = passageWords(passage.text);
    const start = phraseStart(expected, entry.phrase);
    const spoken = spokenText(entry, expected, start, lead);
    const prompt = promptFor(promptMode, passage.text, entry.phrase);
    const words = renderTake(entry, spoken, fresh, { prompt, degrade, condition, suppressNst, trimHead, trimTail });
    scores.push(scoreTake(entry, { id: entry.id, spoken, words }, lead));
  }

  console.log(
    `prompt=${promptMode} degrade=${degrade} condition=${condition} suppressNst=${suppressNst}`
    + ` trimHead=${trimHead}ms trimTail=${trimTail}ms leadWords=${lead}`,
  );
  report(scores, argv.includes("--summary"));
  if (argv.includes("--write-fixtures")) {
    mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    const takes = selected.map((entry) => {
      const score = scores.find((candidate) => candidate.id === entry.id)!;
      const passage = PASSAGES.find((candidate) => candidate.id === entry.passage)!;
      const expected = passageWords(passage.text);
      const start = phraseStart(expected, entry.phrase);
      const spoken = spokenText(entry, expected, start, lead);
      return {
        ...entry,
        spoken,
        words: renderTake(entry, spoken, false, { prompt: "", degrade, condition, suppressNst, trimHead, trimTail }).map((word) => ({
          text: word.text,
          start: Number(word.start.toFixed(3)),
          end: Number(word.end.toFixed(3)),
          confidence: Number((word.confidence ?? 0).toFixed(4)),
        })),
        transcript: score.transcript,
      };
    });
    writeFileSync(FIXTURE_PATH, `${JSON.stringify({ passages: PASSAGES, takes }, null, 2)}\n`);
    console.log(`\nwrote ${takes.length} takes to ${path.relative(ROOT, FIXTURE_PATH)}`);
  }
}

function report(scores: CaseScore[], summaryOnly = false): void {
  const slips = scores.filter((score) => score.klass !== "clean" && score.klass !== "same-number");
  const controls = scores.filter((score) => score.klass === "clean" || score.klass === "same-number");
  for (const score of summaryOnly ? [] : scores) {
    const mark = score.klass === "clean" || score.klass === "same-number"
      ? (score.flags.length === 0 ? "ok  " : "FP  ")
      : (score.detected ? "hit " : "MISS");
    console.log(`${mark} ${score.id.padEnd(28)} ${score.voice.padEnd(9)} ${score.klass.padEnd(12)} ${score.expectedWord || "-"}→${score.intendedHeard || "-"}`);
    if (!score.detected && score.klass !== "clean" && score.klass !== "same-number") {
      console.log(`     spoken:  ${score.spoken}`);
      console.log(`     whisper: ${score.transcript}`);
      console.log(`     slipHeardByWhisper=${score.whisperHeardSlip} flags=${JSON.stringify(score.flags)}`);
    }
    if (score.falsePositives.length > 0) {
      console.log(`     falsePositives: ${JSON.stringify(score.falsePositives)}`);
      if (score.klass === "clean" || score.klass === "same-number") {
        console.log(`     whisper: ${score.transcript}`);
      }
    }
  }

  const bySet = new Map<string, CaseScore[]>();
  for (const score of slips) {
    bySet.set(score.set, [...(bySet.get(score.set) ?? []), score]);
  }
  console.log("");
  for (const [set, entries] of [...bySet.entries()].sort()) {
    const hits = entries.filter((score) => score.detected).length;
    console.log(`${set}: detected ${hits}/${entries.length} (${((hits / entries.length) * 100).toFixed(1)}%)`);
  }
  const hits = slips.filter((score) => score.detected).length;
  const ceiling = slips.filter((score) => score.whisperHeardSlip).length;
  const falsePositives = scores.reduce((count, score) => count + score.falsePositives.length, 0);
  console.log(`overall: detected ${hits}/${slips.length} (${((hits / slips.length) * 100).toFixed(1)}%)`);
  console.log(`whisper transcribed the slip in ${ceiling}/${slips.length} takes (detector ceiling)`);
  console.log(`controls: ${controls.filter((score) => score.flags.length === 0).length}/${controls.length} clean`);
  console.log(`false positives: ${falsePositives}`);

  const byClass = new Map<string, { hit: number; total: number }>();
  for (const score of slips) {
    const bucket = byClass.get(score.klass) ?? { hit: 0, total: 0 };
    byClass.set(score.klass, { hit: bucket.hit + (score.detected ? 1 : 0), total: bucket.total + 1 });
  }
  console.log("");
  for (const [klass, bucket] of [...byClass.entries()].sort()) {
    console.log(`${klass.padEnd(14)} ${bucket.hit}/${bucket.total}`);
  }
}

main();
