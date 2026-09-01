import { tokenizeManuscript, type ManuscriptToken } from "../../../../src/core/proof/normalize";
import { paragraphsFromHtml } from "./booth";
import { readEnginePrefs } from "./engine-prefs";
import {
  applyChapterPickups,
  applyOriginalTape,
  applyWorkingTape,
  copyOriginalToWorking,
  patchChapter,
  readChapterContent,
  writeChapterAudio,
  type BookProject,
  type ChapterPickup,
  type RecordedWord,
  type RecordedWordTiming,
} from "./store";

const SAMPLE_RATE = 44100;
const WORD_SECONDS = 0.28;
const GAP_SECONDS = 0.08;
const LEAD_SECONDS = 0.35;
const TAIL_SECONDS = 0.45;
const PAUSE_SECONDS = 5.2;

/** Build a fake finished take: original + working WAV, full coverage, and every proof flag kind. */
export async function simulateFinishedTake(project: BookProject, chapterId: string): Promise<BookProject> {
  const html = await readChapterContent(project, chapterId);
  const manuscript = paragraphsFromHtml(html).join("\n");
  const tokens = tokenizeManuscript(manuscript);
  const take = buildDebugTake(chapterId, tokens, manuscript);
  const blob = encodeWav(take.samples);
  const original = await writeChapterAudio(project, chapterId, blob, { slot: "original" });
  if (!original) {
    throw new Error("Could not write the debug original take.");
  }
  let next = applyOriginalTape(project, chapterId, {
    file: original,
    recordedPct: 1,
    resumeWordIndex: Math.max(tokens.length, 1),
    recordedWords: take.recordedWords,
    freshTape: true,
  });
  const working = await copyOriginalToWorking(next, chapterId);
  if (!working) {
    throw new Error("Could not write the debug working take.");
  }
  next = applyWorkingTape(next, chapterId, working);
  next = applyChapterPickups(next, chapterId, take.pickups);
  return patchChapter(next, chapterId, {
    proofTranscript: take.transcript,
    punches: [],
    acxTrafficLight: undefined,
    proofed: true,
    mastered: false,
  });
}

function buildDebugTake(
  chapterId: string,
  tokens: ManuscriptToken[],
  manuscript: string,
): {
  samples: Float32Array;
  recordedWords: RecordedWord[];
  transcript: RecordedWordTiming[];
  pickups: ChapterPickup[];
} {
  const pauseAfter = tokens.length >= 2 ? Math.floor(tokens.length / 3) : -1;
  const recordedWords: RecordedWord[] = [];
  const transcript: RecordedWordTiming[] = [];
  let t = LEAD_SECONDS;
  for (let index = 0; index < tokens.length; index += 1) {
    if (index === pauseAfter) {
      t += PAUSE_SECONDS;
    }
    const start = t;
    const end = t + WORD_SECONDS;
    recordedWords.push({ index, start, end });
    transcript.push({ text: tokens[index].text, start, end });
    t = end + GAP_SECONDS;
  }
  const duration = Math.max(t + TAIL_SECONDS, LEAD_SECONDS + PAUSE_SECONDS + 2);
  const samples = voicedTake(duration, recordedWords, pauseAfter >= 0 ? recordedWords[pauseAfter] : null);
  const pickups = debugPickups(chapterId, tokens, recordedWords, manuscript, pauseAfter);
  return { samples, recordedWords, transcript, pickups };
}

function voicedTake(duration: number, words: RecordedWord[], pauseAt: RecordedWord | null): Float32Array {
  const count = Math.max(1, Math.ceil(duration * SAMPLE_RATE));
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = (Math.random() * 2 - 1) * 0.0004;
  }
  for (const word of words) {
    const from = Math.max(0, Math.floor(word.start * SAMPLE_RATE));
    const to = Math.min(count, Math.ceil(word.end * SAMPLE_RATE));
    const span = Math.max(0.04, word.end - word.start);
    for (let i = from; i < to; i += 1) {
      const time = i / SAMPLE_RATE;
      const local = time - word.start;
      const envelope = Math.sin(Math.PI * (local / span));
      samples[i] +=
        envelope *
        0.12 *
        (Math.sin(2 * Math.PI * 180 * time) * 0.7 + Math.sin(2 * Math.PI * 920 * time) * 0.35);
    }
  }
  if (pauseAt) {
    const from = Math.floor((pauseAt.start - PAUSE_SECONDS) * SAMPLE_RATE);
    const to = Math.floor(pauseAt.start * SAMPLE_RATE);
    for (let i = Math.max(0, from); i < Math.min(count, to); i += 1) {
      samples[i] = (Math.random() * 2 - 1) * 0.0003;
    }
  }
  return samples;
}

function debugPickups(
  chapterId: string,
  tokens: ManuscriptToken[],
  words: RecordedWord[],
  manuscript: string,
  pauseAfter: number,
): ChapterPickup[] {
  const threshold = readEnginePrefs().pause_threshold_seconds;
  const pickups: ChapterPickup[] = [];
  const used = new Set<number>();

  function at(index: number): { token: ManuscriptToken; word: RecordedWord } | null {
    const token = tokens[index];
    const word = words[index];
    if (!token || !word) {
      return null;
    }
    used.add(index);
    return { token, word };
  }

  const sub = at(0);
  if (sub) {
    pickups.push(
      flag(chapterId, "sub", sub.word, sub.token.text, mishear(sub.token.text), manuscript, sub.token, 0.94),
    );
  }
  const skip = at(tokens.length > 2 ? 2 : 1);
  if (skip) {
    pickups.push(flag(chapterId, "skip", skip.word, skip.token.text, "", manuscript, skip.token, 0.91));
  }
  const insertAt = words[1] ?? words[0];
  if (insertAt) {
    const t = insertAt.end;
    pickups.push({
      id: `dbg_${chapterId}_insert`,
      chapter_id: chapterId,
      t_start: t,
      t_end: t + 0.22,
      expected: "",
      heard: "um",
      kind: "insert",
      seat: "narration",
      status: "open",
      confidence: 0.88,
      intent: "proof",
      source_kind: "take",
      line_start: insertAt.start,
      line_end: insertAt.end + 0.22,
      line_text: "um",
    });
  }
  if (pauseAfter >= 0 && words[pauseAfter]) {
    const after = words[pauseAfter];
    const start = Math.max(0, after.start - PAUSE_SECONDS);
    pickups.push({
      id: `dbg_${chapterId}_pause`,
      chapter_id: chapterId,
      t_start: start,
      t_end: after.start,
      expected: `Pause > ${threshold}s`,
      heard: "",
      kind: "pause",
      seat: "narration",
      status: "open",
      confidence: 0.99,
      intent: "proof",
      source_kind: "take",
    });
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (used.has(index) || index % 3 !== 0) {
      continue;
    }
    const hit = at(index);
    if (!hit) {
      continue;
    }
    pickups.push(
      flag(chapterId, "sub", hit.word, hit.token.text, mishear(hit.token.text), manuscript, hit.token, 0.86),
    );
  }
  return pickups;
}

function flag(
  chapterId: string,
  kind: "sub" | "skip",
  word: RecordedWord,
  expected: string,
  heard: string,
  manuscript: string,
  token: ManuscriptToken,
  confidence: number,
): ChapterPickup {
  const line = lineAround(manuscript, token);
  return {
    id: `dbg_${chapterId}_${kind}_${token.index}`,
    chapter_id: chapterId,
    t_start: word.start,
    t_end: word.end,
    expected,
    heard,
    kind,
    seat: "narration",
    status: "open",
    confidence,
    intent: "proof",
    source_kind: "take",
    manuscript_index: token.index,
    line_start: word.start,
    line_end: word.end,
    line_text: line,
  };
}

function mishear(word: string): string {
  if (word.length < 2) {
    return `${word}uh`;
  }
  return `${word.slice(0, -1)}a`;
}

function lineAround(manuscript: string, token: ManuscriptToken): string {
  const before = manuscript.lastIndexOf(".", token.start - 1);
  const after = manuscript.indexOf(".", token.end);
  const start = before >= 0 ? before + 1 : 0;
  const end = after >= 0 ? after + 1 : manuscript.length;
  return manuscript.slice(start, end).trim() || token.text;
}

function encodeWav(samples: Float32Array): Blob {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
