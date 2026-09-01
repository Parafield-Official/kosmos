/**
 * Drive the real desktop app through the Bombers + Girl passage.
 *
 * The unit test hands `liveBackFlag` a hand-built transcript. This runs the
 * whole booth instead: a synthetic narrator reads the passage aloud with fifteen
 * deliberate slips, Chromium's fake capture device presents that recording as
 * the microphone, and the running app follows the manuscript with Parakeet and
 * back-checks it with Whisper exactly as it would for a person. A slip counts as
 * caught only if the app raises a pickup on the right manuscript word.
 *
 * Usage:
 *   npx jiti scripts/bombers-live-run.ts stage    # narration + project folder
 *   npx jiti scripts/bombers-live-run.ts run      # stage, launch, drive, score
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BOMBERS_GIRL, BOMBERS_GIRL_SLIPS } from "../src/core/teleprompter/bombers-girl-fixture";
import { promptTextTokens } from "../src/core/teleprompter/model";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FFMPEG = path.join(ROOT, "vendor", "bin", "ffmpeg");
const STAGE_DIR = path.join(ROOT, ".live-run");
const USER_DATA = path.join(os.homedir(), "Library", "Application Support", "booth-desk");

/** A narrator reading aloud, not a phrase generator: one take, one voice. */
const VOICE = process.env.LIVE_RUN_VOICE ?? "Daniel";
const RATE = Number(process.env.LIVE_RUN_RATE ?? 165);

export interface SlipTarget {
  name: string;
  /** Manuscript word index the app must flag. */
  index: number;
  expected: string;
  heard: string;
}

function words(text: string): string[] {
  return promptTextTokens(text).filter((token) => token.isWord).map((token) => token.text);
}

function lower(text: string): string {
  return text.toLocaleLowerCase("en-US");
}

function indexOfPhrase(expected: string[], phrase: string): number {
  const needles = words(phrase).map(lower);
  for (let start = 0; start <= expected.length - needles.length; start += 1) {
    if (needles.every((needle, offset) => lower(expected[start + offset] ?? "") === needle)) {
      return start;
    }
  }
  throw new Error(`phrase not found: ${phrase}`);
}

/**
 * The passage as the narrator reads it. Substituting inside the token stream
 * keeps every comma and line break, so the synthesized delivery still phrases
 * like prose instead of a word list.
 */
export function narration(): { text: string; targets: SlipTarget[] } {
  const expected = words(BOMBERS_GIRL);
  const targets = BOMBERS_GIRL_SLIPS.map((slip) => {
    const index = indexOfPhrase(expected, slip.phrase) + slip.offset;
    return { name: slip.name, index, expected: expected[index] ?? "", heard: slip.heard };
  });
  const byIndex = new Map(targets.map((target) => [target.index, target.heard]));
  let wordIndex = 0;
  const spoken = promptTextTokens(BOMBERS_GIRL).map((token) => {
    if (!token.isWord) {
      return token.text;
    }
    const replacement = byIndex.get(wordIndex);
    wordIndex += 1;
    return replacement ?? token.text;
  });
  return { text: spoken.join(""), targets };
}

/** 48 kHz mono 16-bit PCM: what Chromium's fake capture device expects. */
export function renderNarration(text: string): string {
  mkdirSync(STAGE_DIR, { recursive: true });
  const key = createHash("sha256").update(`${VOICE}|${RATE}|${text}`).digest("hex").slice(0, 16);
  const wav = path.join(STAGE_DIR, `narration-${key}.wav`);
  if (existsSync(wav)) {
    return wav;
  }
  const aiff = path.join(STAGE_DIR, `narration-${key}.aiff`);
  execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", aiff, text], { stdio: "inherit" });
  execFileSync(FFMPEG, [
    "-y", "-v", "error", "-i", aiff,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    wav,
  ], { stdio: "inherit" });
  return wav;
}

/**
 * A project folder the app will open without a file dialog, built with the
 * app's own core modules so it satisfies the same validation the UI does.
 */
export function stageProject(): { folder: string; chapterId: string } {
  const require = createRequire(import.meta.url);
  const manuscript = require(path.join(ROOT, "dist-core", "manuscript.cjs")) as {
    inferDialogueSpans: (spans: Array<{ text: string; seat: string; style: string[] }>) => unknown;
  };
  const project = require(path.join(ROOT, "dist-core", "project.cjs")) as {
    validateProject: (value: unknown) => void;
  };

  const folder = path.join(STAGE_DIR, "bombers-project");
  mkdirSync(path.join(folder, "manuscript", "chapters"), { recursive: true });
  mkdirSync(path.join(folder, "alignment"), { recursive: true });
  mkdirSync(path.join(folder, "audio"), { recursive: true });

  const chapter = {
    id: "ch01",
    index: 1,
    title: "Bombers + Girl",
    text_path: "manuscript/chapters/01.json",
    pickups_path: "alignment/01.json",
    word_count: words(BOMBERS_GIRL).length,
    estimated_duration_minutes: Math.max(1, Math.round(words(BOMBERS_GIRL).length / 150)),
    author_status: "draft",
  };
  const file = {
    schema: 1,
    id: "bombers_live_run",
    name: "Bombers live run",
    acx_spec_version: readAcxSpecVersion(),
    mode: "solo",
    seats: {
      narration: { label: "Narration", color: "#888888" },
      N1: { label: "N1", color: "#c45c26" },
      N2: { label: "N2", color: "#2c4c7c" },
    },
    chapters: [chapter],
    people: [],
    glossary: [],
    chapter_notes: [],
    punch_recordings: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  project.validateProject(file);

  writeFileSync(
    path.join(folder, chapter.text_path),
    `${JSON.stringify({
      schema: 1,
      spans: manuscript.inferDialogueSpans([{ text: BOMBERS_GIRL, seat: "narration", style: [] }]),
    }, null, 2)}\n`,
  );
  writeFileSync(path.join(folder, "project.json"), `${JSON.stringify(file, null, 2)}\n`);

  // The app reopens this folder on launch, which keeps the run free of dialogs.
  mkdirSync(USER_DATA, { recursive: true });
  const statePath = path.join(USER_DATA, "state.json");
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>
    : {};
  writeFileSync(statePath, `${JSON.stringify({ ...state, recentProject: folder }, null, 2)}\n`);

  return { folder, chapterId: chapter.id };
}

function readAcxSpecVersion(): string {
  const spec = JSON.parse(readFileSync(path.join(ROOT, "acx_spec.json"), "utf8")) as { version?: string };
  if (!spec.version) {
    throw new Error("acx_spec.json is missing a version");
  }
  return spec.version;
}

interface LiveFlag {
  expected: string;
  heard: string;
  expectedIndex: number;
  confidence: number;
  start: number;
  end: number;
}

/**
 * Read what the app is holding, by manuscript word index. The persisted pickup
 * keeps only the words, and this passage repeats words like "the", so grading on
 * text alone would credit a flag raised in the wrong place. `whisperLastWords`
 * is the tail of each graded window, which is what shows where the back-check
 * cut the audio.
 */
const READ_STATE = `(() => {
  const root = document.getElementById("root");
  const key = Object.keys(root).find((name) => name.startsWith("__reactContainer$"));
  const queue = [root[key]];
  const seen = new Set();
  let live = null;
  // Stop at the first match: this runs while the app is decoding audio, and a
  // full tree walk on every poll is load the measurement itself would cause.
  while (queue.length && seen.size < 60000 && !live) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const props = node.memoizedProps;
    if (props && typeof props === "object" && Array.isArray(props.detectedFlags)) {
      live = props;
      break;
    }
    if (node.child) queue.push(node.child);
    if (node.sibling) queue.push(node.sibling);
  }
  if (!live) return null;
  return {
    cursor: live.cursor,
    totalWords: live.totalWords,
    status: live.status,
    error: live.error,
    whisperAttempted: live.whisperAttempted,
    whisperSucceeded: live.whisperSucceeded,
    whisperFailed: live.whisperFailed,
    whisperLastWords: live.whisperLastWords,
    flags: live.detectedFlags.map((flag) => ({
      expected: flag.expected,
      heard: flag.heard,
      expectedIndex: flag.expectedIndex,
      confidence: flag.confidence,
      start: flag.start,
      end: flag.end,
    })),
  };
})()`;

const CLICK = (label: string) => `(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent || "").includes(${JSON.stringify(label)}));
  if (!button) return "missing";
  button.click();
  return "clicked";
})()`;

interface LiveSnapshot {
  cursor: number;
  totalWords: number;
  status: string;
  error: string | null;
  whisperAttempted: number;
  whisperSucceeded: number;
  whisperFailed: number;
  whisperLastWords: string;
  flags: LiveFlag[];
}

export interface RunTrace {
  flags: LiveFlag[];
  /** Tail of each Whisper window, in order, with the second it landed. */
  windows: Array<{ at: number; words: string }>;
  final: LiveSnapshot;
}

async function driveRun(seconds: number, targets: SlipTarget[]): Promise<RunTrace> {
  const { openSession } = await import("./cdp-eval.mjs") as {
    openSession: () => Promise<{ evaluate: (expression: string) => Promise<unknown>; close: () => void }>;
  };
  // A finished run leaves the follow cursor at the end of the chapter. Reload so
  // this take starts on the first word instead of continuing past the passage.
  const reset = await openSession();
  await reset.evaluate("location.reload(); \"reloading\"").catch(() => undefined);
  reset.close();
  await wait(6000);

  const session = await openSession();
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await session.evaluate(CLICK("Open teleprompter")) === "clicked") {
        break;
      }
      await wait(1000);
    }
    await wait(2500);
    const started = await session.evaluate(CLICK("Start narrating"));
    if (started !== "clicked") {
      throw new Error("could not start voice follow; is the teleprompter open?");
    }
    const startedAt = Date.now();
    console.log(`listening… ${seconds}s of narration\n`);

    const windows: Array<{ at: number; words: string }> = [];
    let snapshot: LiveSnapshot | null = null;
    let reported = 0;
    let lastWords = "";
    while (Date.now() - startedAt < seconds * 1000) {
      await wait(1000);
      const next = await session.evaluate(READ_STATE) as LiveSnapshot | null;
      if (!next) {
        continue;
      }
      snapshot = next;
      if (next.whisperLastWords && next.whisperLastWords !== lastWords) {
        lastWords = next.whisperLastWords;
        windows.push({ at: Number(((Date.now() - startedAt) / 1000).toFixed(1)), words: lastWords });
      }
      while (reported < next.flags.length) {
        const flag = next.flags[reported];
        reported += 1;
        if (!flag) {
          continue;
        }
        const target = targets.find((candidate) => candidate.index === flag.expectedIndex);
        console.log(
          `  ${target ? "✓" : "·"} @${String(flag.expectedIndex).padStart(3)} `
          + `${flag.expected} → ${flag.heard} (p=${flag.confidence.toFixed(2)})`
          + `${target ? `  ${target.name}` : "  unexpected"}`,
        );
      }
    }
    await session.evaluate(CLICK("Stop"));
    await wait(3000);
    const final = (await session.evaluate(READ_STATE) as LiveSnapshot | null) ?? snapshot;
    if (!final) {
      throw new Error("the app never reported live status");
    }
    return { flags: final.flags, windows, final };
  } finally {
    session.close();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The detection rate for a take, or null when the app stopped listening. */
function report(targets: SlipTarget[], trace: RunTrace): number | null {
  // A take where the app stopped listening part way through says nothing about
  // detection. Call it out instead of reporting it as a low score.
  if (trace.final.cursor < trace.final.totalWords * 0.9) {
    console.log(
      `\naborted: the app followed ${trace.final.cursor}/${trace.final.totalWords} words`
      + ` over ${trace.final.whisperAttempted} windows`
      + `${trace.final.error ? ` (${trace.final.error})` : ""}. Not scored.`,
    );
    return null;
  }
  const flags = trace.flags;
  const flagged = new Map(flags.map((flag) => [flag.expectedIndex, flag]));
  const hits = targets.filter((target) => flagged.has(target.index));
  const misses = targets.filter((target) => !flagged.has(target.index));
  const extras = flags.filter((flag) => !targets.some((target) => target.index === flag.expectedIndex));
  const rate = (hits.length / targets.length) * 100;

  console.log(`\ncaught ${hits.length}/${targets.length} = ${rate.toFixed(1)}%`);
  if (misses.length > 0) {
    console.log("\nmissed:");
    for (const miss of misses) {
      console.log(`  @${String(miss.index).padStart(3)} ${miss.expected} → ${miss.heard}  (${miss.name})`);
    }
  }
  if (extras.length > 0) {
    console.log(`\nflags on words with no planted slip (${extras.length}):`);
    for (const extra of extras) {
      console.log(`  @${String(extra.expectedIndex).padStart(3)} ${extra.expected} → ${extra.heard} (p=${extra.confidence.toFixed(2)})`);
    }
  }
  console.log(
    `\nfollow reached word ${trace.final.cursor}/${trace.final.totalWords}; `
    + `whisper windows ${trace.final.whisperSucceeded}/${trace.final.whisperAttempted}`
    + `${trace.final.whisperFailed > 0 ? ` (${trace.final.whisperFailed} failed)` : ""}`,
  );
  writeFileSync(
    path.join(STAGE_DIR, "last-run.json"),
    `${JSON.stringify({ at: new Date().toISOString(), voice: VOICE, rate: RATE, targets, ...trace }, null, 2)}\n`,
  );
  console.log(`report: ${path.join(STAGE_DIR, "last-run.json")}`);
  return rate;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "stage";
  const { text, targets } = narration();

  if (command === "stage") {
    const wav = renderNarration(text);
    const staged = stageProject();
    console.log(`narration: ${wav}`);
    console.log(`project:   ${staged.folder}`);
    console.log(`voice:     ${VOICE} @ ${RATE} wpm`);
    console.log(`slips:     ${targets.length}`);
    for (const target of targets) {
      console.log(`  @${String(target.index).padStart(3)} ${target.expected} → ${target.heard}  (${target.name})`);
    }
    return;
  }

  if (command === "run") {
    const takes = Math.max(1, Number(process.argv[3] ?? 1));
    const wav = renderNarration(text);
    const seconds = Math.ceil(durationSeconds(wav)) + 20;
    const rates: number[] = [];
    for (let take = 1; take <= takes; take += 1) {
      if (takes > 1) {
        console.log(`\n===== take ${take}/${takes}`);
      }
      let rate: number | null = null;
      for (let attempt = 0; attempt < 3 && rate === null; attempt += 1) {
        rate = report(targets, await driveRun(seconds, targets));
      }
      if (rate === null) {
        throw new Error("the app stopped listening on three takes in a row");
      }
      rates.push(rate);
    }
    if (rates.length > 1) {
      const mean = rates.reduce((total, value) => total + value, 0) / rates.length;
      console.log(
        `\n${rates.length} takes: ${rates.map((value) => `${value.toFixed(1)}%`).join(", ")}`
        + `  mean ${mean.toFixed(1)}%  worst ${Math.min(...rates).toFixed(1)}%`,
      );
    }
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

function durationSeconds(wav: string): number {
  const probe = path.join(ROOT, "vendor", "bin", "ffprobe");
  const output = execFileSync(probe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", wav,
  ]).toString().trim();
  const seconds = Number(output);
  if (!Number.isFinite(seconds)) {
    throw new Error(`could not read the narration duration: ${output}`);
  }
  return seconds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
