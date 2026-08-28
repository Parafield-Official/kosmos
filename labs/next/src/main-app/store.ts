/**
 * Front-end project store for the main app.
 *
 * The heavy speech/mastering engines live in the original Kosmos app and are not
 * wired here yet, so books persist to localStorage. That keeps the shelf, the
 * per-chapter progress, and completion state durable across quits today, and
 * gives us a stable shape to swap onto a real backend bridge later.
 */

import type { GlossaryEntry, Pickup } from "../../../../src/core/project/types";
import { normalizeProjectSettings } from "../../../../src/core/project/settings";
import { mergeLivePickup } from "../../../../src/core/teleprompter/live";

const PROJECTS_KEY = "kosmos-projects";
const LAST_PROJECT_KEY = "kosmos-last-project";

export type ChapterStage = "blank" | "recording" | "proofing" | "mastering" | "done";
export type AudioSlot = "original" | "working";
export type PromptHighlightMode = "word" | "line" | "paragraph";
export type ReadingFont = "serif" | "sans" | "palatino" | "courier" | "clear" | "hyperlegible";
export type PromptTheme = "dark" | "sepia" | "cream";

export type RoomCheckStatus = "pass" | "warn" | "fail";

/** Last room-tone measurement for this book. */
export interface RoomCheckReport {
  recordedAt: string;
  durationSeconds: number;
  noiseFloorDbfs: number;
  speechRmsDbfs: number;
  neededBoostDb: number;
  predictedFloorDbfs: number;
  targetRmsDbfs: number;
  status: RoomCheckStatus;
  warning: string;
}

/** Live or proof flag kept on the chapter for Review / punch-in. */
export type ChapterPickup = Pickup;

/** One retake clip spliced into the working file. Original tape stays untouched. */
export interface ChapterPunch {
  id: string;
  chapter_id: string;
  pickup_id?: string;
  path: string;
  t_start: number;
  t_end: number;
  /** How many seconds the working file grew or shrank when this punch landed. */
  durationDelta?: number;
  trim_silence?: boolean;
  edit_status: "applied" | "reverted";
  expected?: string;
  heard?: string;
  created_at?: string;
}

/** Word-clock for the original booth tape so Continue can resume in place. */
export interface RecordedWord {
  index: number;
  start: number;
  end: number;
}

/** Word clock from proof or booth, without a manuscript index. */
export interface RecordedWordTiming {
  text: string;
  start: number;
  end: number;
}

export interface BookChapter {
  id: string;
  title: string;
  wordCount: number;
  /** 0..1 of manuscript words that have timestamps on the original tape. */
  recordedPct: number;
  /** True once the original booth read (or an imported take) exists. */
  hasOriginalAudio: boolean;
  /** True once proof/master has produced the working file on top of original. */
  hasWorkingAudio: boolean;
  /** Stable original tape filename (`{chapterId}-original.wav`). */
  originalFile?: string;
  /** Stable working tape filename (`{chapterId}-working.wav`). Proof then master. */
  workingFile?: string;
  /** Next manuscript word to continue from. */
  resumeWordIndex: number;
  /** Aligned words on the original tape. */
  recordedWords?: RecordedWord[];
  /** Whisper or booth word timings on the original tape, used to highlight-redo. */
  proofTranscript?: RecordedWordTiming[];
  /** Last ACX check on the working file. */
  acxTrafficLight?: "green" | "yellow" | "red";
  /** Live and proof flags on this chapter. */
  pickups?: ChapterPickup[];
  /** Punch clips applied onto the working file (history for rebuild/undo). */
  punches?: ChapterPunch[];
  proofed: boolean;
  mastered: boolean;
}

export interface BookProject {
  id: string;
  title: string;
  author: string;
  /** Data-URL cover art shown on the shelf. */
  coverDataUrl?: string;
  chapters: BookChapter[];
  createdAt: string;
  updatedAt: string;
  /** Set when the project has been exported end-to-end. */
  completedAt?: string;
  /** Absolute folder path when backed by the filesystem (Electron). */
  folder?: string;
  /** True when the folder lives outside the workspace (a linked book). */
  external?: boolean;
  /** Filename of the imported manuscript, if any. */
  manuscript?: string;
  /** Pronunciation rows for this book. Resolve once; later chapters inherit. */
  glossary?: GlossaryEntry[];
  /** Spellings the narrator removed so auto-scan will not flag them again. */
  glossaryDismissed?: string[];
  /** Last 10–20s room-tone measurement. */
  roomCheck?: RoomCheckReport;
  /** Proof words this book should never flag. Set from Review. */
  suppressedWords?: string[];
}

function now(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

function normalizePickups(raw: unknown, chapterId: string): ChapterPickup[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const pickups = raw.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Partial<Pickup>;
    if (typeof row.id !== "string" || typeof row.expected !== "string") {
      return [];
    }
    const start = Number(row.t_start);
    const end = Number(row.t_end);
    return [{
      id: row.id,
      chapter_id: typeof row.chapter_id === "string" ? row.chapter_id : chapterId,
      t_start: Number.isFinite(start) ? start : 0,
      t_end: Number.isFinite(end) ? end : 0,
      expected: row.expected,
      heard: typeof row.heard === "string" ? row.heard : "",
      kind: row.kind === "skip" || row.kind === "insert" || row.kind === "pause" ? row.kind : "sub",
      seat: row.seat === "N1" || row.seat === "N2" ? row.seat : "narration",
      status: row.status === "done" || row.status === "ignored" ? row.status : "open",
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
      note: typeof row.note === "string" ? row.note : undefined,
      intent: row.intent === "performance" ? "performance" : "proof",
      source_kind: row.source_kind === "take" ? "take" : "live",
      manuscript_index: typeof row.manuscript_index === "number" ? row.manuscript_index : undefined,
      line_start: typeof row.line_start === "number" ? row.line_start : undefined,
      line_end: typeof row.line_end === "number" ? row.line_end : undefined,
      line_text: typeof row.line_text === "string" ? row.line_text : undefined,
      selection_kind:
        row.selection_kind === "selection" || row.selection_kind === "sentence" || row.selection_kind === "paragraph"
          ? row.selection_kind
          : undefined,
    } satisfies ChapterPickup];
  });
  return pickups.length ? pickups : undefined;
}

function normalizeProofTranscript(raw: unknown): RecordedWordTiming[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const words = raw.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Partial<RecordedWordTiming>;
    const start = Number(row.start);
    const end = Number(row.end);
    if (typeof row.text !== "string" || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    return [{ text: row.text, start, end } satisfies RecordedWordTiming];
  });
  return words.length ? words : undefined;
}

function normalizePunches(raw: unknown, chapterId: string): ChapterPunch[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const punches = raw.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Partial<ChapterPunch>;
    if (typeof row.id !== "string" || typeof row.path !== "string") {
      return [];
    }
    const start = Number(row.t_start);
    const end = Number(row.t_end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    const deltaRaw = (row as { durationDelta?: number; duration_delta?: number }).durationDelta
      ?? (row as { duration_delta?: number }).duration_delta;
    const durationDelta = Number(deltaRaw);
    return [{
      id: row.id,
      chapter_id: typeof row.chapter_id === "string" ? row.chapter_id : chapterId,
      pickup_id: typeof row.pickup_id === "string" ? row.pickup_id : undefined,
      path: row.path,
      t_start: start,
      t_end: end,
      durationDelta: Number.isFinite(durationDelta) ? durationDelta : undefined,
      trim_silence: row.trim_silence !== false,
      edit_status: row.edit_status === "reverted" ? "reverted" : "applied",
      expected: typeof row.expected === "string" ? row.expected : undefined,
      heard: typeof row.heard === "string" ? row.heard : undefined,
      created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    } satisfies ChapterPunch];
  });
  return punches.length ? punches : undefined;
}

function normalizeGlossary(raw: unknown): GlossaryEntry[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const entries = raw.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Partial<GlossaryEntry>;
    if (typeof row.id !== "string" || typeof row.spelling !== "string" || !row.spelling.trim()) {
      return [];
    }
    return [{
      id: row.id,
      spelling: row.spelling.trim(),
      respell: typeof row.respell === "string" && row.respell.trim() ? row.respell.trim() : undefined,
      voice_note: typeof row.voice_note === "string" && row.voice_note.trim() ? row.voice_note.trim() : undefined,
      clip_path: typeof row.clip_path === "string" ? row.clip_path : undefined,
      frequency: Number.isFinite(Number(row.frequency)) ? Number(row.frequency) : 0,
      source: row.source === "user" ? "user" : "auto",
    } satisfies GlossaryEntry];
  });
  return entries;
}

function normalizeDismissed(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const key = item.trim().toLocaleLowerCase("en-US");
    if (key && !seen.has(key)) {
      seen.add(key);
      words.push(key);
    }
  }
  return words;
}

function normalizeSuppressedField(raw: unknown): string[] | undefined {
  const words = normalizeProjectSettings({ suppressed_words: raw }).suppressed_words;
  return words.length ? words : undefined;
}

function normalizeRoomCheck(raw: unknown): RoomCheckReport | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const row = raw as Partial<RoomCheckReport>;
  const status = row.status === "pass" || row.status === "warn" || row.status === "fail" ? row.status : null;
  if (!status || typeof row.warning !== "string") {
    return undefined;
  }
  return {
    recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : new Date().toISOString(),
    durationSeconds: Number(row.durationSeconds) || 0,
    noiseFloorDbfs: Number(row.noiseFloorDbfs),
    speechRmsDbfs: Number(row.speechRmsDbfs),
    neededBoostDb: Number(row.neededBoostDb) || 0,
    predictedFloorDbfs: Number(row.predictedFloorDbfs),
    targetRmsDbfs: Number(row.targetRmsDbfs) || -20,
    status,
    warning: row.warning,
  };
}

/** Fill in any fields a legacy or partial record is missing so the UI never
 * hits an undefined title/author/chapters. */
function normalizeProject(raw: Partial<BookProject> & Record<string, unknown>): BookProject {
  const chapters = Array.isArray(raw.chapters) ? (raw.chapters as BookChapter[]) : [];
  return {
    id: typeof raw.id === "string" ? raw.id : uid("bk"),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "Untitled book",
    author: typeof raw.author === "string" ? raw.author : "",
    coverDataUrl: typeof raw.coverDataUrl === "string" ? raw.coverDataUrl : undefined,
    chapters: chapters.map((chapter) => {
      const rawChapter = chapter as BookChapter & { takes?: Array<{ file?: string; kind?: string }> };
      const legacyTakes = Array.isArray(rawChapter.takes)
        ? rawChapter.takes.filter((take) => take && typeof take.file === "string")
        : [];
      const originalFile =
        typeof chapter?.originalFile === "string"
          ? chapter.originalFile
          : legacyTakes.find((take) => take.kind === "original")?.file ?? legacyTakes[0]?.file;
      const workingFile =
        typeof chapter?.workingFile === "string"
          ? chapter.workingFile
          : legacyTakes.find((take) => take.kind === "working")?.file;
      const recordedWords = Array.isArray(chapter?.recordedWords)
        ? (chapter.recordedWords as RecordedWord[]).filter(
            (word) => word && typeof word.index === "number" && Number.isFinite(word.start),
          )
        : undefined;
      const proofTranscript = normalizeProofTranscript(chapter?.proofTranscript);
      const light = chapter?.acxTrafficLight;
      return {
        id: typeof chapter?.id === "string" ? chapter.id : uid("ch"),
        title: typeof chapter?.title === "string" ? chapter.title : "Untitled chapter",
        wordCount: typeof chapter?.wordCount === "number" ? chapter.wordCount : 0,
        recordedPct: typeof chapter?.recordedPct === "number" ? chapter.recordedPct : 0,
        originalFile,
        workingFile,
        hasOriginalAudio: Boolean(originalFile) || Boolean(chapter?.hasOriginalAudio),
        hasWorkingAudio: Boolean(workingFile) || Boolean(chapter?.hasWorkingAudio),
        resumeWordIndex: typeof chapter?.resumeWordIndex === "number" ? chapter.resumeWordIndex : 0,
        recordedWords,
        proofTranscript,
        acxTrafficLight: light === "green" || light === "yellow" || light === "red" ? light : undefined,
        pickups: normalizePickups(chapter?.pickups, typeof chapter?.id === "string" ? chapter.id : ""),
        punches: normalizePunches(chapter?.punches, typeof chapter?.id === "string" ? chapter.id : ""),
        proofed: Boolean(chapter?.proofed),
        mastered: Boolean(chapter?.mastered),
      };
    }),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now(),
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
    folder: typeof raw.folder === "string" ? raw.folder : undefined,
    external: raw.external === true ? true : undefined,
    manuscript: typeof raw.manuscript === "string" ? raw.manuscript : undefined,
    glossary: normalizeGlossary(raw.glossary),
    glossaryDismissed: normalizeDismissed(raw.glossaryDismissed),
    roomCheck: normalizeRoomCheck(raw.roomCheck),
    suppressedWords: normalizeSuppressedField(raw.suppressedWords),
  };
}

function byUpdatedDesc(a: BookProject, b: BookProject): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function readAll(): BookProject[] {
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => normalizeProject(item as Partial<BookProject> & Record<string, unknown>));
  } catch {
    return [];
  }
}

/** First two letters for the cover fallback, safe on empty titles. */
export function bookInitials(project: { title?: string }): string {
  const title = (project.title ?? "").trim();
  return (title ? title.slice(0, 2) : "??").toUpperCase();
}

function writeAll(projects: BookProject[]) {
  try {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // A full or private store just means the shelf is not durable this session.
  }
}

/** Most-recently-updated first, so the shelf reads like a recents list. */
export function listProjects(): BookProject[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): BookProject | null {
  return readAll().find((project) => project.id === id) ?? null;
}

export function createProject(input: {
  title: string;
  author: string;
  coverDataUrl?: string;
}): BookProject {
  const project: BookProject = {
    id: uid("bk"),
    title: input.title.trim() || "Untitled book",
    author: input.author.trim(),
    coverDataUrl: input.coverDataUrl,
    chapters: [],
    createdAt: now(),
    updatedAt: now(),
  };
  const projects = readAll();
  projects.push(project);
  writeAll(projects);
  setLastProjectId(project.id);
  return project;
}

export function saveProject(next: BookProject): BookProject {
  const stamped = { ...next, updatedAt: now() };
  const projects = readAll();
  const index = projects.findIndex((project) => project.id === stamped.id);
  if (index === -1) {
    projects.push(stamped);
  } else {
    projects[index] = stamped;
  }
  writeAll(projects);
  return stamped;
}

export function deleteProject(id: string) {
  writeAll(readAll().filter((project) => project.id !== id));
  if (getLastProjectId() === id) {
    setLastProjectId(null);
  }
}

export function addChapter(projectId: string, title: string): BookProject | null {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }
  const chapter: BookChapter = {
    id: uid("ch"),
    title: title.trim() || `Chapter ${project.chapters.length + 1}`,
    wordCount: 0,
    recordedPct: 0,
    hasOriginalAudio: false,
    hasWorkingAudio: false,
    resumeWordIndex: 0,
    proofed: false,
    mastered: false,
  };
  return saveProject({ ...project, chapters: [...project.chapters, chapter] });
}

export function getLastProjectId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastProjectId(id: string | null) {
  try {
    if (id) {
      window.localStorage.setItem(LAST_PROJECT_KEY, id);
    } else {
      window.localStorage.removeItem(LAST_PROJECT_KEY);
    }
  } catch {
    // Non-fatal; the shelf still opens, just without a remembered book.
  }
}

/** Whole-book progress as 0..1 across record -> proof -> master for each chapter. */
export function bookProgress(project: BookProject): number {
  if (project.chapters.length === 0) {
    return 0;
  }
  const perChapter = project.chapters.map((chapter) => {
    const record = Math.min(1, Math.max(0, chapter.recordedPct));
    const proof = chapter.proofed ? 1 : 0;
    const master = chapter.mastered ? 1 : 0;
    return (record + proof + master) / 3;
  });
  const total = perChapter.reduce((sum, value) => sum + value, 0);
  return total / project.chapters.length;
}

/** Pure helper: returns a new project with an appended chapter. */
export function appendChapter(project: BookProject, title: string): BookProject {
  const chapter: BookChapter = {
    id: uid("ch"),
    title: title.trim() || `Chapter ${project.chapters.length + 1}`,
    wordCount: 0,
    recordedPct: 0,
    hasOriginalAudio: false,
    hasWorkingAudio: false,
    resumeWordIndex: 0,
    proofed: false,
    mastered: false,
  };
  return { ...project, chapters: [...project.chapters, chapter] };
}

// ── Backend-aware async API ───────────────────────────────────
// Prefers the Electron filesystem bridge (folder-per-book inside the
// workspace). Falls back to localStorage in the hosted browser preview.

function hasProjectBridge(): boolean {
  return Boolean(
    window.kosmosNext?.listProjects &&
      window.kosmosNext?.createProject &&
      window.kosmosNext?.saveProjectFile,
  );
}

export async function getWorkspacePath(): Promise<string | null> {
  if (window.kosmosNext?.getWorkspace) {
    try {
      const result = await window.kosmosNext.getWorkspace();
      return result.workspace;
    } catch {
      return null;
    }
  }
  return null;
}

/** Open the system folder picker and persist the workspace choice. */
export async function chooseWorkspace(): Promise<string | null> {
  const { requestFolderAccess } = await import("../access");
  const result = await requestFolderAccess();
  let path = result.path ?? null;
  if (!path && result.state === "granted") {
    path = await getWorkspacePath();
  }
  if (path) {
    window.dispatchEvent(new Event("kosmos-workspace-changed"));
  }
  return path;
}

export async function loadProjects(): Promise<BookProject[]> {
  if (hasProjectBridge()) {
    try {
      const result = await window.kosmosNext!.listProjects!();
      return (result.projects ?? [])
        .map((item) => normalizeProject(item as Partial<BookProject> & Record<string, unknown>))
        .sort(byUpdatedDesc);
    } catch {
      return [];
    }
  }
  return listProjects();
}

export async function createBook(input: {
  title: string;
  author: string;
  coverDataUrl?: string;
}): Promise<BookProject> {
  if (hasProjectBridge()) {
    const created = await window.kosmosNext!.createProject!(input);
    return normalizeProject(created as Partial<BookProject> & Record<string, unknown>);
  }
  return createProject(input);
}

export async function persistBook(project: BookProject): Promise<BookProject> {
  if (hasProjectBridge() && project.folder && window.kosmosNext?.saveProjectFile) {
    const saved = await window.kosmosNext.saveProjectFile(project);
    return normalizeProject(saved as Partial<BookProject> & Record<string, unknown>);
  }
  return saveProject(project);
}

export async function openBook(): Promise<{
  project?: BookProject;
  external?: boolean;
  canceled?: boolean;
  invalid?: boolean;
}> {
  if (window.kosmosNext?.openProjectFolder) {
    const result = await window.kosmosNext.openProjectFolder();
    if (result.ok && result.project) {
      return {
        project: normalizeProject(result.project as Partial<BookProject> & Record<string, unknown>),
        external: result.external,
      };
    }
    return { canceled: result.canceled, invalid: result.invalid };
  }
  return { canceled: true };
}

/** Move a linked (external) book's folder into the workspace. */
export async function moveIntoWorkspace(project: BookProject): Promise<BookProject | null> {
  if (project.folder && window.kosmosNext?.moveProjectIntoWorkspace) {
    const result = await window.kosmosNext.moveProjectIntoWorkspace(project.folder);
    if (result.ok && result.project) {
      return normalizeProject(result.project as Partial<BookProject> & Record<string, unknown>);
    }
  }
  return null;
}

/** Keep a book where it is, but register it so it shows on the shelf. */
export async function linkExternal(project: BookProject): Promise<BookProject> {
  if (project.folder && window.kosmosNext?.linkExternalProject) {
    const result = await window.kosmosNext.linkExternalProject(project.folder);
    if (result.ok && result.project) {
      return normalizeProject(result.project as Partial<BookProject> & Record<string, unknown>);
    }
  }
  return project;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the file."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Copy an uploaded manuscript file into the project's manuscript/ folder. */
export async function writeManuscript(folder: string | undefined, file: File): Promise<string | null> {
  if (!folder || !window.kosmosNext?.writeManuscript) {
    return null;
  }
  const base64 = await fileToBase64(file);
  const result = await window.kosmosNext.writeManuscript({ folder, name: file.name, base64 });
  return result.ok ? result.manuscript ?? file.name : null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Chapter content (rich text per chapter) ───────────────────

function chapterContentKey(project: BookProject, chapterId: string): string {
  return `kosmos-chapter:${project.folder ?? project.id}:${chapterId}`;
}

export async function writeChapterContents(
  project: BookProject,
  contents: { id: string; html: string }[],
): Promise<void> {
  if (project.folder && window.kosmosNext?.writeChapterContents) {
    await window.kosmosNext.writeChapterContents({ folder: project.folder, chapters: contents });
    return;
  }
  for (const item of contents) {
    try {
      window.localStorage.setItem(chapterContentKey(project, item.id), item.html);
    } catch {
      // Best effort in the hosted fallback.
    }
  }
}

export async function saveChapterContent(
  project: BookProject,
  chapterId: string,
  html: string,
): Promise<void> {
  if (project.folder && window.kosmosNext?.writeChapterContent) {
    await window.kosmosNext.writeChapterContent({ folder: project.folder, chapterId, html });
    return;
  }
  try {
    window.localStorage.setItem(chapterContentKey(project, chapterId), html);
  } catch {
    // Best effort.
  }
}

export async function readChapterContent(project: BookProject, chapterId: string): Promise<string> {
  if (project.folder && window.kosmosNext?.readChapterContent) {
    const result = await window.kosmosNext.readChapterContent({ folder: project.folder, chapterId });
    return result.html ?? "";
  }
  try {
    return window.localStorage.getItem(chapterContentKey(project, chapterId)) ?? "";
  } catch {
    return "";
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the recording."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function audioExtension(mime?: string, name?: string): string {
  const fromName = name?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName) {
    return fromName;
  }
  if (!mime) {
    return "webm";
  }
  if (mime.includes("wav")) {
    return "wav";
  }
  if (mime.includes("mpeg") || mime.includes("mp3")) {
    return "mp3";
  }
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) {
    return "m4a";
  }
  if (mime.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

const AUDIO_DB = "kosmos-chapter-audio";
const AUDIO_STORE = "blobs";

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUDIO_STORE)) {
        request.result.createObjectStore(AUDIO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putLocalAudio(file: string, blob: Blob): Promise<void> {
  const db = await openAudioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readwrite");
    tx.objectStore(AUDIO_STORE).put(blob, file);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getLocalAudio(file: string): Promise<Blob | null> {
  try {
    const db = await openAudioDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE, "readonly");
      const request = tx.objectStore(AUDIO_STORE).get(file);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

function slotFileName(chapterId: string, slot: AudioSlot, mime?: string, name?: string): string {
  return `${chapterId}-${slot}.${audioExtension(mime, name)}`;
}

/** Write the original or working slot. There are only two files per chapter. */
export async function writeChapterAudio(
  project: BookProject,
  chapterId: string,
  blob: Blob,
  options?: { slot?: AudioSlot; name?: string },
): Promise<string | null> {
  const slot = options?.slot ?? "original";
  const mime = blob.type || (options?.name ? `audio/${audioExtension(undefined, options.name)}` : "audio/wav");
  if (project.folder && window.kosmosNext?.writeChapterAudio) {
    const base64 = await blobToBase64(blob);
    const result = await window.kosmosNext.writeChapterAudio({
      folder: project.folder,
      chapterId,
      base64,
      mime,
      slot,
    });
    return result.ok ? result.file ?? null : null;
  }
  const file = slotFileName(chapterId, slot, blob.type, options?.name);
  try {
    await putLocalAudio(file, blob);
    return file;
  } catch {
    return null;
  }
}

/** Duplicate the original tape into the working slot (proof starts from original). */
export async function copyOriginalToWorking(project: BookProject, chapterId: string): Promise<string | null> {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter?.originalFile) {
    return null;
  }
  if (project.folder && window.kosmosNext?.copyToWorking) {
    const result = await window.kosmosNext.copyToWorking({
      folder: project.folder,
      chapterId,
      file: chapter.originalFile,
    });
    return result.ok ? result.file ?? null : null;
  }
  const bytes = await readChapterAudioBytes(project, chapter.originalFile);
  if (!bytes) {
    return null;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return writeChapterAudio(project, chapterId, new Blob([copy], { type: "audio/wav" }), { slot: "working" });
}

/** Read a saved take back as an object URL for playback. */
export async function readChapterAudioUrl(project: BookProject, file: string): Promise<string | null> {
  if (project.folder && window.kosmosNext?.readChapterAudio) {
    const result = await window.kosmosNext.readChapterAudio({ folder: project.folder, file });
    if (result.ok && result.base64) {
      const bytes = base64ToBytes(result.base64);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return URL.createObjectURL(new Blob([arrayBuffer]));
    }
  }
  const local = await getLocalAudio(file);
  return local ? URL.createObjectURL(local) : null;
}

/** Raw bytes of a saved slot, for concatenating Continue onto the original tape. */
export async function readChapterAudioBytes(project: BookProject, file: string): Promise<Uint8Array | null> {
  if (project.folder && window.kosmosNext?.readChapterAudio) {
    const result = await window.kosmosNext.readChapterAudio({ folder: project.folder, file });
    if (result.ok && result.base64) {
      return base64ToBytes(result.base64);
    }
  }
  const local = await getLocalAudio(file);
  if (!local) {
    return null;
  }
  return new Uint8Array(await local.arrayBuffer());
}

/** Word count from rendered chapter HTML. */
export function countHtmlWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ");
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** Read a stored manuscript back out of the project folder (for re-analysis). */
export async function readManuscriptBytes(
  project: BookProject,
): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (project.folder && window.kosmosNext?.readManuscript) {
    const result = await window.kosmosNext.readManuscript({ folder: project.folder, name: project.manuscript });
    if (result.ok && result.base64) {
      return { name: result.name ?? project.manuscript ?? "manuscript.txt", bytes: base64ToBytes(result.base64) };
    }
  }
  return null;
}

export async function deleteBook(project: BookProject): Promise<void> {
  if (project.folder && window.kosmosNext?.deleteProjectFolder) {
    await window.kosmosNext.deleteProjectFolder(project.folder);
    return;
  }
  deleteProject(project.id);
}

export function chapterStage(chapter: BookChapter): ChapterStage {
  if (chapter.mastered) {
    return "done";
  }
  if (chapter.proofed) {
    return "mastering";
  }
  if (chapter.recordedPct >= 1) {
    return "proofing";
  }
  if (chapter.recordedPct > 0 || chapter.hasOriginalAudio) {
    return "recording";
  }
  return "blank";
}

/** Save or replace the original booth tape and resume cursor. */
export function applyOriginalTape(
  project: BookProject,
  chapterId: string,
  patch: {
    file: string | null;
    recordedPct: number;
    resumeWordIndex: number;
    recordedWords?: RecordedWord[];
    freshTape?: boolean;
  },
): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((chapter) => {
      if (chapter.id !== chapterId) {
        return chapter;
      }
      const reset = Boolean(patch.freshTape);
      return {
        ...chapter,
        originalFile: patch.file ?? chapter.originalFile,
        hasOriginalAudio: Boolean(patch.file ?? chapter.originalFile),
        recordedPct: Math.min(1, Math.max(0, patch.recordedPct)),
        resumeWordIndex: Math.max(0, patch.resumeWordIndex),
        recordedWords: patch.recordedWords ?? chapter.recordedWords,
        proofTranscript: reset || patch.recordedWords ? undefined : chapter.proofTranscript,
        acxTrafficLight: reset ? undefined : chapter.acxTrafficLight,
        proofed: reset ? false : chapter.proofed,
        mastered: reset ? false : chapter.mastered,
      };
    }),
  };
}

/** Clear the original tape so the narrator can start over. Working file is kept. */
export function clearOriginalTape(project: BookProject, chapterId: string): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((chapter) => {
      if (chapter.id !== chapterId) {
        return chapter;
      }
      return {
        ...chapter,
        originalFile: undefined,
        hasOriginalAudio: false,
        recordedPct: 0,
        resumeWordIndex: 0,
        recordedWords: undefined,
        proofTranscript: undefined,
        acxTrafficLight: undefined,
        proofed: false,
        mastered: false,
      };
    }),
  };
}

/** Point the working slot at a proof/master file derived from original. */
export function applyWorkingTape(project: BookProject, chapterId: string, file: string): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, workingFile: file, hasWorkingAudio: true } : chapter,
    ),
  };
}

/** File or merge a live/proof pickup onto the chapter. */
export function applyChapterPickup(project: BookProject, chapterId: string, pickup: ChapterPickup): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((chapter) => {
      if (chapter.id !== chapterId) {
        return chapter;
      }
      return { ...chapter, pickups: mergeLivePickup(chapter.pickups ?? [], pickup) };
    }),
  };
}

export function applyChapterPickups(project: BookProject, chapterId: string, pickups: ChapterPickup[]): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, pickups } : chapter)),
  };
}

export function applyChapterPunches(project: BookProject, chapterId: string, punches: ChapterPunch[]): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, punches } : chapter)),
  };
}

export function patchChapter(
  project: BookProject,
  chapterId: string,
  patch: Partial<BookChapter>,
): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, ...patch } : chapter)),
  };
}
