/**
 * Prove the whole-book features on real recordings, not on written fixtures.
 *
 * The unit tests for the occurrence scan, the book pickup list and word
 * suppression all feed the aligner a transcript we typed. That proves the
 * grouping logic, and nothing about whether a name read two ways in two
 * chapters actually lands in two groups once a real recogniser has had its say.
 *
 * Here two chapters are spoken by the system voices, with one hard name read
 * correctly in the first and wrongly in the second, decoded with the bundled
 * whisper build. Everything after that is the app's own code.
 *
 * Usage: npx jiti scripts/verify-book.ts [--keep]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { alignTranscript, type TranscriptWord } from "../src/core/proof/align";
import { scanBookOccurrences, type ChapterSource } from "../src/core/proof/book-scan";
import { summarizeBookPickups } from "../src/core/proof/book-pickups";
import { findSilences } from "../src/core/proof/silence";
import { normalizeProjectSettings } from "../src/core/project/settings";
import { suggestRespelling } from "../src/core/glossary/respell";
import { parsePronouncingDictionary } from "../src/core/glossary/candidates";
import type { Pickup } from "../src/core/project/types";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffmpeg = path.join(root, "vendor", "bin", "ffmpeg");
const whisper = path.join(root, "vendor", "bin", "whisper-cli");
const modelPath = path.join(os.homedir(), "Library", "Application Support", "booth-desk", "models", "ggml-small.en.bin");
const dictionaryPath = path.join(root, "vendor", "cmudict", "cmudict.dict");
const { segmentWords } = require("../electron/asr.cjs") as { segmentWords: (segments: unknown[]) => TranscriptWord[] };

for (const [label, file] of [
  ["ffmpeg", ffmpeg],
  ["whisper-cli", whisper],
  ["speech model", modelPath],
  ["pronouncing dictionary", dictionaryPath],
] as const) {
  if (!existsSync(file)) {
    console.error(`Missing ${label} at ${file}. Run npm run prepare:model first.`);
    process.exit(1);
  }
}

const keep = process.argv.includes("--keep");
const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-book-"));
const failures: string[] = [];
let checks = 0;

function check(claim: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`ok    ${claim}`);
    return;
  }
  failures.push(claim);
  console.log(`FAIL  ${claim}${detail ? `\n        ${detail}` : ""}`);
}

interface Take {
  id: string;
  title: string;
  index: number;
  /** What is written on the page. */
  manuscript: string;
  /** What the narrator says, spelled for the speech synthesiser. */
  spoken: string;
  voice: string;
}

/**
 * Two chapters where the same name is read two ways. "Leominster" in England is
 * said "LEM-ster"; a narrator who has not been told reads it as spelled, and
 * the point of the scan is to show both readings side by side.
 */
const TAKES: Take[] = [
  {
    id: "ch01",
    title: "The Road",
    index: 1,
    manuscript: "The Leominster road was flooded, and the Leominster bridge had gone.",
    spoken: "The Lemster road was flooded, and the Lemster bridge had gone.",
    voice: "Daniel",
  },
  {
    id: "ch02",
    title: "The Bridge",
    index: 2,
    manuscript: "By morning the Leominster road was open again.",
    spoken: "By morning the Lee-ominster road was open again.",
    voice: "Samantha",
  },
  {
    id: "ch03",
    title: "The Letter",
    index: 3,
    // Recorded but read wrong, so the book list has something to collect.
    manuscript: "He carried the heavy black case up four flights of stairs.",
    spoken: "He carried the black case up four flights of stairs.",
    voice: "Karen",
  },
];

function narrate(take: Take): string {
  const base = path.join(workspace, `${take.index}_${take.id}`);
  execFileSync("say", ["-v", take.voice, "-o", `${base}.aiff`, take.spoken], { stdio: "ignore" });
  execFileSync(ffmpeg, [
    "-y", "-v", "error", "-i", `${base}.aiff`,
    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", `${base}.wav`,
  ], { stdio: "ignore" });
  return `${base}.wav`;
}

function transcribe(wav: string): TranscriptWord[] {
  const base = `${wav}.transcript`;
  execFileSync(whisper, ["-m", modelPath, "-f", wav, "-l", "en", "-ojf", "-of", base, "-np"], { stdio: "ignore" });
  return segmentWords(JSON.parse(readFileSync(`${base}.json`, "utf8")).transcription ?? []);
}

function duration(wav: string): number {
  return Number(execFileSync(
    path.join(root, "vendor", "bin", "ffprobe"),
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
    { encoding: "utf8" },
  ).trim());
}

function silences(wav: string) {
  const rate = 8000;
  const pcm = execFileSync(ffmpeg, [
    "-v", "error", "-i", wav,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", String(rate), "pipe:1",
  ], { maxBuffer: 256 * 1024 * 1024 });
  return findSilences(new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4)), rate, 1);
}

console.log(`Speaking ${TAKES.length} chapters and decoding them with the bundled whisper build.\n`);

const chapters: ChapterSource[] = [];
const pickupsByChapter = new Map<string, Pickup[]>();
for (const take of TAKES) {
  const wav = narrate(take);
  const transcript = transcribe(wav);
  chapters.push({
    chapterId: take.id,
    chapterTitle: take.title,
    chapterIndex: take.index,
    manuscript: take.manuscript,
    transcript,
  });
  const aligned = alignTranscript({
    chapterId: take.id,
    manuscript: take.manuscript,
    transcript,
    durationSeconds: duration(wav),
    minConfidence: 0.35,
    silences: silences(wav),
  });
  pickupsByChapter.set(take.id, aligned.pickups);
  console.log(`      ${take.title}: ${transcript.map((word) => word.text).join(" ")}`);
}
console.log("");

// A chapter written but not yet recorded, which the book views must report
// rather than quietly leave out.
chapters.push({
  chapterId: "ch04",
  chapterTitle: "The Harbour",
  chapterIndex: 4,
  manuscript: "The Leominster train left the harbour at six.",
});

const scan = scanBookOccurrences("Leominster", chapters);
check(
  "the scan finds every appearance of the name across the book",
  scan.totalOccurrences === 4,
  `found ${scan.totalOccurrences}: ${JSON.stringify(scan.readings.map((group) => group.occurrences.length))}`,
);
check(
  "it counts only the appearances in chapters that have been recorded",
  scan.checkedOccurrences === 3,
  `checked ${scan.checkedOccurrences}`,
);
check(
  "it names the chapter that has no recording yet",
  scan.chaptersWithoutAudio.includes("The Harbour"),
  JSON.stringify(scan.chaptersWithoutAudio),
);
const spoken = scan.readings.filter((group) => group.occurrences[0]?.readingKey !== "#no-audio");
check(
  "a name read two ways comes back as two readings",
  spoken.length >= 2,
  spoken.map((group) => `${group.heard} ×${group.count}`).join(" | "),
);
check("and the book is reported as inconsistent", scan.consistent === false);
check(
  "the two readings of the same name really are different words",
  new Set(spoken.map((group) => group.occurrences[0].readingKey)).size === spoken.length,
  spoken.map((group) => group.occurrences[0].readingKey).join(" | "),
);
check(
  "every checked appearance can be played from where it was said",
  spoken.every((group) => group.occurrences.every((occurrence) =>
    typeof occurrence.start === "number" && occurrence.start >= 0 && occurrence.start < 30)),
  JSON.stringify(spoken.flatMap((group) => group.occurrences.map((occurrence) => occurrence.start))),
);
check(
  "each appearance carries enough of the sentence to recognise it",
  spoken.every((group) => group.occurrences.every((occurrence) => occurrence.context.length > 10)),
);
console.log(`      readings: ${spoken.map((group) => `"${group.heard}" ×${group.count}`).join(", ")}\n`);

// The same scan on a name that was read the same way every time must come back
// clean, or the feature is just an alarm that is always on.
const consistentScan = scanBookOccurrences("road", chapters.filter((chapter) => chapter.transcript));
check(
  "a word read the same way every time is reported as consistent",
  consistentScan.consistent === true && consistentScan.totalOccurrences >= 2,
  `${consistentScan.totalOccurrences} appearances, ${consistentScan.readings.length} readings: `
  + consistentScan.readings.map((group) => group.heard).join(" | "),
);

// The whole-book pickup list, built from the real proof passes above.
const summary = summarizeBookPickups(TAKES.map((take) => ({
  chapterId: take.id,
  chapterTitle: take.title,
  chapterIndex: take.index,
  pickups: pickupsByChapter.get(take.id) ?? [],
  hasAudio: true,
  checked: true,
})).concat([
  {
    chapterId: "ch04",
    chapterTitle: "The Harbour",
    chapterIndex: 4,
    pickups: [],
    hasAudio: false,
    checked: false,
  },
  {
    // Recorded but never proofed: the one case a narrator must not lose track of.
    chapterId: "ch05",
    chapterTitle: "The Tide",
    chapterIndex: 5,
    pickups: [],
    hasAudio: true,
    checked: false,
  },
]));
const dropped = summary.open.find((row) => /heavy/i.test(row.pickup.expected));
check(
  "the book list collects the dropped word from the third chapter",
  Boolean(dropped) && dropped?.chapterTitle === "The Letter",
  JSON.stringify(summary.open.map((row) => `${row.chapterTitle}: ${row.pickup.expected} → ${row.pickup.heard}`)),
);
check(
  "the book list reports a chapter that was recorded but never checked",
  summary.uncheckedChapters.map((chapter) => chapter.chapterTitle).join() === "The Tide",
  JSON.stringify(summary.uncheckedChapters.map((chapter) => chapter.chapterTitle)),
);
check(
  "progress is counted for every chapter, recorded or not",
  summary.chapters.length === 5 && summary.openCount === summary.open.length,
  JSON.stringify(summary.chapters.map((row) => `${row.chapterTitle}: ${row.open} open`)),
);
check(
  "the same name flagged in more than one place is grouped",
  summary.repeated.length === 0 || summary.repeated.every((entry) => entry.count >= 2),
  JSON.stringify(summary.repeated.map((entry) => `${entry.word} ×${entry.count}`)),
);

// Suppression, through the real settings normalizer a project would save.
const flaggedWord = summary.open[0]?.pickup.expected.split(/\s+/u)[0] ?? "";
const settings = normalizeProjectSettings({
  suppressed_words: [` ${flaggedWord.toUpperCase()} `, flaggedWord.toLowerCase(), ""],
});
check(
  "a word the narrator clears is stored once, however it was typed",
  settings.suppressed_words.length === 1,
  JSON.stringify(settings.suppressed_words),
);
const chapterWithFlag = TAKES.find((take) =>
  (pickupsByChapter.get(take.id) ?? []).some((entry) =>
    entry.expected.toLowerCase().split(/\s+/u).includes(flaggedWord.toLowerCase())));
if (!chapterWithFlag) {
  check("a chapter with a flag to clear", false, `nothing flagged "${flaggedWord}"`);
} else {
  const before = pickupsByChapter.get(chapterWithFlag.id) ?? [];
  const mentions = before.filter((entry) =>
    entry.expected.toLowerCase().split(/\s+/u).includes(flaggedWord.toLowerCase()));
  const source = chapters.find((chapter) => chapter.chapterId === chapterWithFlag.id);
  const after = alignTranscript({
    chapterId: chapterWithFlag.id,
    manuscript: chapterWithFlag.manuscript,
    transcript: source?.transcript ?? [],
    minConfidence: 0.35,
    suppressedWords: settings.suppressed_words,
  }).pickups;
  check(
    "clearing that word for the book takes every flag on it off the list",
    after.length === before.length - mentions.length && mentions.length > 0,
    `${before.length} before, ${after.length} after, cleared ${mentions.length} × "${flaggedWord}"`,
  );
  check(
    "and nothing else on the list moves",
    after.every((pickup) => !pickup.expected.toLowerCase().split(/\s+/u).includes(flaggedWord.toLowerCase())),
    JSON.stringify(after.map((pickup) => pickup.expected)),
  );
}

// Respellings, read from the dictionary the app ships rather than a stub.
const lexicon = parsePronouncingDictionary(readFileSync(dictionaryPath, "utf8"));
// Names a stranger would misread, with the respelling the bundled dictionary
// gives. Where a place has two accepted readings the dictionary picks one, and
// the row stays editable — which is the whole point of the glossary.
const expectedRespells: ReadonlyArray<readonly [string, string]> = [
  ["Worcester", "WUU-ster"],
  ["Gloucester", "GLAH-ster"],
  ["Beauchamp", "BOH-shahmp"],
  ["Hermione", "her-mee-OH-nee"],
  ["Siobhan", "SHOW-bahn"],
];
for (const [word, expected] of expectedRespells) {
  const suggestion = suggestRespelling(word, lexicon);
  check(
    `the bundled dictionary respells ${word} as ${expected}`,
    suggestion === expected,
    `got ${suggestion ?? "nothing"}`,
  );
}
check(
  "an invented name gets no made-up pronunciation",
  suggestRespelling("Kaelthorn", lexicon) === null,
  String(suggestRespelling("Kaelthorn", lexicon)),
);
check(
  "a name spelled as it sounds is still offered, so a person can confirm it",
  suggestRespelling("Elena", lexicon) === "EL-uh-nah",
  String(suggestRespelling("Elena", lexicon)),
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
console.log("The whole-book views hold up on real recordings.");
