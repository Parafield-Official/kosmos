import { readFileSync, writeFileSync } from "node:fs";
import { matchLiveWindow, liveBackFlag, type LiveExpectedWord, type LiveMatchState } from "../src/core/teleprompter/live";
import { promptTextTokens } from "../src/core/teleprompter/model";

const MANUSCRIPT = [
  "Leaflets",
  "At dusk they pour from the sky. They blow across the rampars, turn cartwheels over rooftops, flutter into the ravines between houses.",
  "Entire streets swirl with them, flashing white against the cob-bles.",
  "Urgent message to the inhabitants of this town, they say.",
  "Depart immediately to open country.",
  "The tide climbs. The moon hangs small and yellow and gibbous.",
  "On the rooftops of beachfront hotels to the east, and in the gardens behind them, a half-dozen American artillery units drop incendiary rounds into the mouths of mortars.",
].join(" ");

const expected: LiveExpectedWord[] = promptTextTokens(MANUSCRIPT)
  .filter((token) => token.isWord)
  .map((token, index) => ({ index, lineIndex: 0, text: token.text }));

function whisperText(path: string): string {
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    return (json.transcription ?? []).map((seg: { text?: string }) => String(seg.text ?? "").trim()).join(" ");
  } catch {
    return "";
  }
}

function whisperWords(path: string) {
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const words: { text: string; start: number; end: number; confidence: number }[] = [];
    for (const seg of json.transcription ?? []) {
      for (const token of seg.tokens ?? []) {
        const text = String(token.text ?? "").trim();
        if (!/[\p{L}\p{N}]/u.test(text)) {
          continue;
        }
        const start = Number(token.offsets?.from ?? 0) / 1000;
        const end = Number(token.offsets?.to ?? 0) / 1000;
        const p = Number(token.p);
        words.push({ text, start, end, confidence: Number.isFinite(p) ? p : 0.75 });
      }
    }
    if (words.length > 0) {
      return words;
    }
    return String(whisperText(path)).split(/\s+/).filter(Boolean).map((text, i) => ({
      text, start: i * 0.3, end: i * 0.3 + 0.25, confidence: 0.9,
    }));
  } catch {
    return [];
  }
}

function parakeetHops(path: string) {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function startAt(phrase: string): number {
  const needles = promptTextTokens(phrase).filter((token) => token.isWord).map((token) => token.text.toLocaleLowerCase("en-US"));
  for (let start = 0; start <= expected.length - needles.length; start += 1) {
    if (needles.every((needle, offset) => expected[start + offset]?.text.toLocaleLowerCase("en-US") === needle)) {
      return start;
    }
  }
  throw new Error(phrase);
}

const takes = [
  { id: "01_clean_urgent", start: "Urgent message to", slip: null as null | { expected: string; heard: string } },
  { id: "02_said_on_not_to", start: "Urgent message to", slip: { expected: "to", heard: "on" } },
  { id: "03_said_a_not_the", start: "They blow across", slip: { expected: "the", heard: "a" } },
  { id: "04_said_on_not_in", start: "On the rooftops", slip: { expected: "in", heard: "on" } },
  { id: "05_clipped_cartwheel", start: "They blow across", slip: { expected: "cartwheels", heard: "cartwheel" } },
  { id: "06_tripped_inhabitants", start: "Urgent message to", slip: { expected: "inhabitants", heard: "inhibitants" } },
  { id: "07_late_on_flashing", start: "Entire streets swirl", slip: { expected: "flashing", heard: "ashing" } },
  { id: "08_skipped_heading", start: "Leaflets", slip: null },
  { id: "09_dropped_immediately", start: "Depart immediately to", slip: { expected: "immediately", heard: "" } },
];

for (const take of takes) {
  const hops = parakeetHops(`/tmp/leaflets-takes/${take.id}_parakeet.jsonl`);
  const startCursor = startAt(take.start);
  let state: LiveMatchState = { cursor: startCursor, lastHeardEnd: 0 };
  const cursorTrace: number[] = [startCursor];
  let finalized = 0;
  const openText: string[] = [];
  for (const hop of hops) {
    if (hop.text) {
      openText.push(String(hop.text));
    }
    const words = (hop.words ?? []).map((w: { w?: string; word?: string; start: number; end: number; conf?: number }) => ({
      text: String(w.w ?? w.word ?? ""),
      start: Number(w.start),
      end: Number(w.end),
      confidence: Number(w.conf ?? 0.75),
    })).filter((w: { text: string }) => w.text);
    finalized += words.length;
    if (words.length === 0) {
      cursorTrace.push(state.cursor);
      continue;
    }
    const result = matchLiveWindow({
      chapterId: "leaflets",
      expected,
      transcript: words,
      state,
      flagsEnabled: false,
    });
    state = result.state;
    cursorTrace.push(state.cursor);
  }
  const greedy = whisperText(`/tmp/leaflets-takes/${take.id}_greedy.json`).toLowerCase();
  const beam = whisperText(`/tmp/leaflets-takes/${take.id}_beam5.json`).toLowerCase();
  const qcWords = whisperWords(`/tmp/leaflets-takes/${take.id}_beam5.json`);
  const flag = liveBackFlag({
    chapterId: "leaflets",
    expected,
    transcript: qcWords,
    state: { cursor: 0, lastHeardEnd: 0 },
    flagsEnabled: true,
    goldCursor: state.cursor,
    confidenceThreshold: 0.9,
  });
  const moved = cursorTrace.some((value, index) => index > 0 && value !== cursorTrace[index - 1]);
  const goldWord = expected[Math.max(0, state.cursor - 1)]?.text ?? "(start)";
  console.log(`\n=== ${take.id} ===`);
  console.log(`gold: ${startCursor} -> ${state.cursor}  lastWord=${goldWord}  hops=${hops.length}  finalized=${finalized}  cursorMoved=${moved ? "YES" : "NO"}`);
  console.log(`cursor: ${cursorTrace.join(">")}`);
  console.log(`parakeet preview text: ${openText.join(" | ") || "(none)"}`);
  console.log(`whisper greedy: ${greedy}`);
  console.log(`whisper beam5:  ${beam}`);
  if (take.slip?.heard) {
    console.log(`slip ${take.slip.expected}->${take.slip.heard}  greedy_heard=${greedy.includes(take.slip.heard)}  beam5_heard=${beam.includes(take.slip.heard)}`);
  }
  console.log(`qc vs gold ${state.cursor}: ${flag ? `${flag.expected} -> ${flag.heard} #${flag.expectedIndex}` : "none"}`);
}

writeFileSync("/tmp/leaflets-takes/done.txt", "ok");
