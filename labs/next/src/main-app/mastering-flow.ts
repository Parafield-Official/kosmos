import { importChapterOriginal } from "./chapter-actions";
import { masterChapterWorking } from "./punch";
import {
  appendChapter,
  applyWorkingTape,
  copyOriginalToWorking,
  patchChapter,
  type BookProject,
} from "./store";

export const AUDIO_FILE_ACCEPT =
  ".wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.aiff,.aif,audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/flac,audio/ogg";

const AUDIO_NAME = /\.(wav|mp3|m4a|aac|flac|ogg|oga|aiff|aif|wma)$/i;

/** Chapter title from a take filename (`Chapter_01.wav` → `Chapter 01`). */
export function audioTitleFromName(name: string): string {
  return name.replace(/\.[^.]+$/u, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Chapter";
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_NAME.test(file.name);
}

/** Keep chapter 2 before chapter 10 when narrators drop a folder of takes. */
export function sortAudioFiles(files: readonly File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** Keep the caller’s order — used after the narrator has dragged files into place. */
export function audioFilesInOrder(list: FileList | File[] | null | undefined): File[] {
  if (!list) {
    return [];
  }
  return Array.from(list).filter(isAudioFile);
}

export function collectAudioFiles(list: FileList | File[] | null | undefined): File[] {
  return sortAudioFiles(audioFilesInOrder(list));
}

const DUMMY_MASTERING_NAMES = [
  "01 The Drift.wav",
  "02 Glass Harbor.wav",
  "03 Night Radio.wav",
  "04 The Last Orbit.wav",
  "05 Return.wav",
] as const;

export const DUMMY_MASTERING_TITLE = "The Silent Orbit";

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Tiny valid WAV so tests can check a header without a voice. */
export function silentWavFile(name: string, seconds = 2, sampleRate = 44100): File {
  const samples = Math.max(1, Math.round(sampleRate * seconds));
  return pcm16WavFile(name, new Float32Array(samples), sampleRate);
}

function pcm16WavFile(name: string, samples: Float32Array, sampleRate: number): File {
  const dataSize = samples.length * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, Math.round(clamped * 32767), true);
    offset += 2;
  }
  return new File([bytes], name, { type: "audio/wav" });
}

/** Quiet room tone around a voiced-like tone so ACX mastering has a speech region. */
export function voiceLikeWavFile(name: string, seconds = 6, sampleRate = 44100, seed = 1): File {
  const count = Math.max(1, Math.round(sampleRate * seconds));
  const samples = new Float32Array(count);
  const head = Math.round(sampleRate * 0.7);
  const tail = Math.round(sampleRate * 0.7);
  const f0 = 108 + seed * 8;
  let noise = seed * 0.137;
  function nextNoise() {
    noise = (noise * 1664525 + 1013904223) % 4294967296;
    return (noise / 4294967296) * 2 - 1;
  }
  for (let i = 0; i < count; i += 1) {
    const room = nextNoise() * 0.00045;
    if (i < head || i >= count - tail) {
      samples[i] = room;
      continue;
    }
    const t = i / sampleRate;
    const syllable = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3.1 * t));
    const voice =
      0.24 * Math.sin(2 * Math.PI * f0 * t) +
      0.12 * Math.sin(2 * Math.PI * f0 * 2 * t) +
      0.06 * Math.sin(2 * Math.PI * f0 * 3 * t) +
      0.03 * Math.sin(2 * Math.PI * f0 * 4 * t);
    samples[i] = room + voice * syllable;
  }
  return pcm16WavFile(name, samples, sampleRate);
}

export function dummyMasteringFiles(): File[] {
  return DUMMY_MASTERING_NAMES.map((name, index) => voiceLikeWavFile(name, 6.2 + index * 0.4, 44100, index + 1));
}

export async function importMasteringTake(
  project: BookProject,
  chapterId: string,
  file: File,
): Promise<BookProject> {
  let next = await importChapterOriginal(project, chapterId, file);
  const working = await copyOriginalToWorking(next, chapterId);
  if (!working) {
    throw new Error("Could not prepare a working copy to master.");
  }
  next = applyWorkingTape(next, chapterId, working);
  // Audio-only jobs skip proofreading; mark the chapter ready for the master chain.
  return patchChapter(next, chapterId, { proofed: true });
}

/** Turn uploaded takes into one chapter each, in the given order. */
export async function importMasteringFiles(project: BookProject, files: File[]): Promise<BookProject> {
  const incoming = audioFilesInOrder(files);
  if (!incoming.length) {
    throw new Error("Add at least one audio file.");
  }
  let next = project;
  for (const file of incoming) {
    next = appendChapter(next, audioTitleFromName(file.name));
    const chapter = next.chapters[next.chapters.length - 1];
    next = await importMasteringTake(next, chapter.id, file);
  }
  return next;
}

export async function masterAllChapters(
  project: BookProject,
  onChapter?: (next: BookProject, chapterId: string) => void,
): Promise<{ project: BookProject; failures: Array<{ title: string; reason: string }> }> {
  let next = project;
  const failures: Array<{ title: string; reason: string }> = [];
  for (const chapter of project.chapters) {
    const current = next.chapters.find((item) => item.id === chapter.id);
    if (!current || current.mastered) {
      continue;
    }
    if (!current.workingFile && current.originalFile) {
      const working = await copyOriginalToWorking(next, current.id);
      if (working) {
        next = applyWorkingTape(next, current.id, working);
      }
    }
    if (!next.chapters.find((item) => item.id === current.id)?.workingFile) {
      failures.push({ title: current.title, reason: "No working copy to master." });
      continue;
    }
    try {
      next = await masterChapterWorking(next, current.id);
      onChapter?.(next, current.id);
    } catch (reason) {
      failures.push({
        title: current.title,
        reason: reason instanceof Error ? reason.message : "Mastering failed.",
      });
    }
  }
  return { project: next, failures };
}
