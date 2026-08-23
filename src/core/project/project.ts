import {
  PROJECT_SCHEMA,
  type AuthorStatus,
  type ChapterFile,
  type ProjectFile,
  type ProjectMode,
  type Seat,
  type SeatDefinition,
} from "./types";
import { DEFAULT_PROJECT_SETTINGS } from "./settings";

const DEFAULT_SEATS: Record<Seat, SeatDefinition> = {
  narration: { label: "Narration", color: "#888888" },
  N1: { label: "N1", color: "#c45c26" },
  N2: { label: "N2", color: "#2c4c7c" },
};

const DEFAULT_ACX_SPEC_VERSION = "2026-acx";

export interface CreateProjectOptions {
  id?: string;
  now?: string;
  mode?: ProjectMode;
}

function projectId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

export function createEmptyProject(
  name: string,
  options: CreateProjectOptions = {},
): ProjectFile {
  const now = options.now ?? isoNow();
  const mode = options.mode ?? "solo";

  return {
    schema: PROJECT_SCHEMA,
    id: options.id ?? projectId(),
    name: name.trim() || "Untitled project",
    mode,
    acx_spec_version: DEFAULT_ACX_SPEC_VERSION,
    author: "",
    narrator_n1: "",
    narrator_n2: "",
    people: [],
    seats: structuredClone(DEFAULT_SEATS),
    chapters: [],
    glossary: [],
    chapter_notes: [],
    punch_recordings: [],
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    created_at: now,
    updated_at: now,
  };
}

export function addChapter(
  project: ProjectFile,
  chapter: Omit<ChapterFile, "author_status"> & { author_status?: AuthorStatus },
  now = isoNow(),
): ProjectFile {
  const nextChapter: ChapterFile = {
    ...chapter,
    author_status: chapter.author_status ?? "draft",
  };

  return {
    ...project,
    chapters: [...project.chapters, nextChapter].sort((a, b) => a.index - b.index),
    updated_at: now,
  };
}

export function updateProject(
  project: ProjectFile,
  patch: Partial<Pick<ProjectFile, "name" | "mode" | "author" | "narrator_n1" | "narrator_n2" | "people" | "seats" | "settings">>,
  now = isoNow(),
): ProjectFile {
  return { ...project, ...patch, updated_at: now };
}

export function serializeProject(project: ProjectFile): string {
  validateProject(project);
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function parseProject(serialized: string): ProjectFile {
  let value: unknown;

  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`project.json is not valid JSON: ${String(error)}`);
  }

  validateProject(value);
  return value;
}

export function validateProject(value: unknown): asserts value is ProjectFile {
  if (!value || typeof value !== "object") {
    throw new Error("project.json must contain an object");
  }

  const candidate = value as Partial<ProjectFile>;
  if (candidate.schema !== PROJECT_SCHEMA) {
    throw new Error(`Unsupported project schema: ${String(candidate.schema)}`);
  }
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    throw new Error("project.json is missing an id");
  }
  if (!isSafeIdentifier(candidate.id)) {
    throw new Error("project.json has an unsafe project id");
  }
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    throw new Error("project.json is missing a name");
  }
  if (candidate.acx_spec_version !== DEFAULT_ACX_SPEC_VERSION) {
    throw new Error(`Unsupported ACX spec version: ${String(candidate.acx_spec_version)}`);
  }
  if (candidate.mode !== "solo" && candidate.mode !== "duet") {
    throw new Error("project.json has an invalid mode");
  }
  if (!candidate.seats || !isSeatMap(candidate.seats)) {
    throw new Error("project.json is missing seat definitions");
  }
  if (!Array.isArray(candidate.chapters)) {
    throw new Error("project.json chapters must be an array");
  }
  const chapterIds = new Set<string>();
  const chapterIndices = new Set<number>();
  const chapterTextPaths = new Set<string>();
  const chapterPickupPaths = new Set<string>();
  candidate.chapters.forEach((chapter, index) => {
    validateChapter(chapter, index);
    const normalizedChapter = chapter as ChapterFile;
    if (chapterIds.has(normalizedChapter.id)) {
      throw new Error(`project.json has a duplicate chapter id: ${normalizedChapter.id}`);
    }
    if (chapterIndices.has(normalizedChapter.index)) {
      throw new Error(`project.json has a duplicate chapter index: ${normalizedChapter.index}`);
    }
    const textPathKey = normalizedChapter.text_path.toLocaleLowerCase("en-US");
    const pickupPathKey = normalizedChapter.pickups_path?.toLocaleLowerCase("en-US");
    if (chapterTextPaths.has(textPathKey)) {
      throw new Error(`project.json reuses a chapter text path: ${normalizedChapter.text_path}`);
    }
    if (pickupPathKey && chapterPickupPaths.has(pickupPathKey)) {
      throw new Error(`project.json reuses an alignment path: ${normalizedChapter.pickups_path}`);
    }
    chapterIds.add(normalizedChapter.id);
    chapterIndices.add(normalizedChapter.index);
    chapterTextPaths.add(textPathKey);
    if (pickupPathKey) {
      chapterPickupPaths.add(pickupPathKey);
    }
  });
  if (!Array.isArray(candidate.people)) {
    throw new Error("project.json people must be an array");
  }
  const personNames = new Set<string>();
  candidate.people.forEach((person, index) => {
    validatePerson(person, index);
    const name = (person as { name: string }).name.trim().toLocaleLowerCase("en-US");
    if (personNames.has(name)) {
      throw new Error(`project.json has a duplicate person: ${name}`);
    }
    personNames.add(name);
  });
  for (const field of ["author", "narrator_n1", "narrator_n2"] as const) {
    if (candidate[field] !== undefined && typeof candidate[field] !== "string") {
      throw new Error(`project.json ${field} must be a string`);
    }
  }
  if (candidate.room_test_path !== undefined && !isAudioPath(candidate.room_test_path)) {
    throw new Error("project.json has an unsafe room test path");
  }
  for (const field of ["created_at", "updated_at"] as const) {
    if (typeof candidate[field] !== "string" || candidate[field].trim().length === 0) {
      throw new Error(`project.json is missing ${field}`);
    }
  }
  validateSettings(candidate.settings);
  validateGlossary(candidate.glossary);
  validateChapterNotes(candidate.chapter_notes, chapterIds);
  validatePunchRecordings(candidate.punch_recordings, chapterIds);
}

function validateChapter(value: unknown, position: number): void {
  if (!value || typeof value !== "object") {
    throw new Error(`project.json chapter ${position + 1} must be an object`);
  }
  const chapter = value as Partial<ChapterFile>;
  if (typeof chapter.id !== "string" || chapter.id.length === 0 || !isSafeIdentifier(chapter.id)) {
    throw new Error(`project.json chapter ${position + 1} is missing an id`);
  }
  if (!Number.isInteger(chapter.index) || (chapter.index ?? 0) <= 0) {
    throw new Error(`project.json chapter ${chapter.id} has an invalid index`);
  }
  if (typeof chapter.title !== "string" || chapter.title.trim().length === 0) {
    throw new Error(`project.json chapter ${chapter.id} is missing a title`);
  }
  if (!isManuscriptPath(chapter.text_path)) {
    throw new Error(`project.json chapter ${chapter.id} has an unsafe text path`);
  }
  if (!(["draft", "needs_pickup", "approved", "ignore_this_flag"] as const).includes(chapter.author_status as AuthorStatus)) {
    throw new Error(`project.json chapter ${chapter.id} has an invalid author status`);
  }
  for (const field of [
    "audio_path",
    "raw_audio_path",
    "edited_audio_path",
    "live_audio_path",
    "bed_audio_path",
    "overdub_audio_path",
    "duet_mix_path",
    "n1_stem_path",
    "n2_stem_path",
    "pickups_path",
    "notes_path",
  ] as const) {
    const relativePath = chapter[field];
    const valid = field === "pickups_path"
      ? isAlignmentPath(relativePath)
      : field === "notes_path"
        ? isNotesPath(relativePath)
        : relativePath === undefined || isAudioPath(relativePath);
    if (relativePath !== undefined && !valid) {
      const label = field === "pickups_path" ? "alignment path" : field;
      throw new Error(`project.json chapter ${chapter.id} has an unsafe ${label}`);
    }
  }
  if (chapter.open_pickups !== undefined && (!Number.isInteger(chapter.open_pickups) || chapter.open_pickups < 0)) {
    throw new Error(`project.json chapter ${chapter.id} has an invalid open pickup count`);
  }
  for (const field of ["word_count", "estimated_duration_minutes"] as const) {
    if (chapter[field] !== undefined && (!Number.isFinite(chapter[field]) || chapter[field] < 0)) {
      throw new Error(`project.json chapter ${chapter.id} has an invalid ${field}`);
    }
  }
  if (chapter.acx_traffic_light !== undefined && !["green", "yellow", "red"].includes(chapter.acx_traffic_light)) {
    throw new Error(`project.json chapter ${chapter.id} has an invalid ACX traffic light`);
  }
  for (const field of ["duration_warning", "updated_at"] as const) {
    if (chapter[field] !== undefined && typeof chapter[field] !== "string") {
      throw new Error(`project.json chapter ${chapter.id} has an invalid ${field}`);
    }
  }
}

function validatePerson(value: unknown, position: number): void {
  if (!value || typeof value !== "object") {
    throw new Error(`project.json person ${position + 1} must be an object`);
  }
  const person = value as { name?: unknown; role?: unknown; seat?: unknown };
  if (typeof person.name !== "string" || person.name.trim().length === 0) {
    throw new Error(`project.json person ${position + 1} needs a name`);
  }
  if (person.role !== "author" && person.role !== "narrator") {
    throw new Error(`project.json person ${position + 1} has an invalid role`);
  }
  if (person.seat !== undefined && person.seat !== "N1" && person.seat !== "N2") {
    throw new Error(`project.json person ${position + 1} has an invalid seat`);
  }
}

function validateGlossary(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error("project.json glossary must be an array");
  }
  const ids = new Set<string>();
  value.forEach((entry, position) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`project.json glossary entry ${position + 1} must be an object`);
    }
    const candidate = entry as { id?: unknown; spelling?: unknown; respell?: unknown; voice_note?: unknown; clip_path?: unknown; frequency?: unknown; source?: unknown; seats?: unknown };
    if (typeof candidate.id !== "string" || candidate.id.length === 0 || !isSafeIdentifier(candidate.id) || typeof candidate.spelling !== "string" || candidate.spelling.trim().length === 0) {
      throw new Error(`project.json glossary entry ${position + 1} is malformed`);
    }
    if (ids.has(candidate.id)) {
      throw new Error(`project.json has a duplicate glossary id: ${candidate.id}`);
    }
    ids.add(candidate.id);
    if (candidate.respell !== undefined && typeof candidate.respell !== "string") {
      throw new Error(`project.json glossary entry ${candidate.id} has an invalid respell`);
    }
    if (candidate.voice_note !== undefined && typeof candidate.voice_note !== "string") {
      throw new Error(`project.json glossary entry ${candidate.id} has an invalid voice note`);
    }
    if (candidate.clip_path !== undefined && !isAudioPath(candidate.clip_path)) {
      throw new Error(`project.json glossary entry ${candidate.id} has an unsafe clip path`);
    }
    if (candidate.frequency !== undefined && (!Number.isFinite(candidate.frequency) || (candidate.frequency as number) < 0)) {
      throw new Error(`project.json glossary entry ${candidate.id} has an invalid frequency`);
    }
    if (candidate.source !== undefined && candidate.source !== "auto" && candidate.source !== "user") {
      throw new Error(`project.json glossary entry ${candidate.id} has an invalid source`);
    }
    if (candidate.seats !== undefined && (!Array.isArray(candidate.seats) || candidate.seats.some((seat) => !["narration", "N1", "N2"].includes(seat as string)))) {
      throw new Error(`project.json glossary entry ${candidate.id} has invalid seats`);
    }
  });
}

function validateChapterNotes(value: unknown, chapterIds: Set<string>): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error("project.json chapter_notes must be an array");
  }
  const ids = new Set<string>();
  value.forEach((note, position) => {
    if (!note || typeof note !== "object") {
      throw new Error(`project.json chapter note ${position + 1} must be an object`);
    }
    const candidate = note as Partial<{ id: string; chapter_id: string; author: string; body: string; created_at: string }>;
    for (const field of ["id", "chapter_id", "author", "body", "created_at"] as const) {
      if (typeof candidate[field] !== "string" || candidate[field].trim().length === 0) {
        throw new Error(`project.json chapter note ${position + 1} is missing ${field}`);
      }
    }
    const id = candidate.id as string;
    const chapterId = candidate.chapter_id as string;
    if (ids.has(id)) {
      throw new Error(`project.json has a duplicate chapter note id: ${id}`);
    }
    if (!chapterIds.has(chapterId)) {
      throw new Error(`project.json chapter note ${id} references an unknown chapter`);
    }
    ids.add(id);
  });
}

function validatePunchRecordings(value: unknown, chapterIds: Set<string>): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error("project.json punch_recordings must be an array");
  }
  const ids = new Set<string>();
  value.forEach((punch, position) => {
    if (!punch || typeof punch !== "object") {
      throw new Error(`project.json punch ${position + 1} must be an object`);
    }
    const candidate = punch as Partial<{ id: string; chapter_id: string; path: string; edited_path: string; created_at: string; t_start: number; t_end: number; expected: string; heard: string; trim_silence: boolean; verification_status: "needs_verification" | "verified" }>;
    for (const field of ["id", "chapter_id", "path", "created_at"] as const) {
      if (typeof candidate[field] !== "string" || candidate[field].trim().length === 0) {
        throw new Error(`project.json punch ${position + 1} is missing ${field}`);
      }
    }
    const id = candidate.id as string;
    const chapterId = candidate.chapter_id as string;
    if (ids.has(id)) {
      throw new Error(`project.json has a duplicate punch id: ${id}`);
    }
    if (!chapterIds.has(chapterId)) {
      throw new Error(`project.json punch ${id} references an unknown chapter`);
    }
    ids.add(id);
    if (!isAudioPath(candidate.path) || (candidate.edited_path !== undefined && !isAudioPath(candidate.edited_path))) {
      throw new Error(`project.json punch ${position + 1} has an unsafe audio path`);
    }
    if (candidate.t_start !== undefined && (!Number.isFinite(candidate.t_start) || candidate.t_start < 0)) {
      throw new Error(`project.json punch ${position + 1} has an invalid start time`);
    }
    if (candidate.t_end !== undefined && (!Number.isFinite(candidate.t_end) || candidate.t_end < 0)) {
      throw new Error(`project.json punch ${position + 1} has an invalid end time`);
    }
    if (candidate.t_start !== undefined && candidate.t_end !== undefined && candidate.t_end < candidate.t_start) {
      throw new Error(`project.json punch ${candidate.id} has reversed timing`);
    }
    for (const field of ["expected", "heard"] as const) {
      if (candidate[field] !== undefined && typeof candidate[field] !== "string") {
        throw new Error(`project.json punch ${candidate.id} has invalid ${field} text`);
      }
    }
    if (candidate.trim_silence !== undefined && typeof candidate.trim_silence !== "boolean") {
      throw new Error(`project.json punch ${candidate.id} has invalid trim behavior`);
    }
    if (candidate.verification_status !== undefined && candidate.verification_status !== "needs_verification" && candidate.verification_status !== "verified") {
      throw new Error(`project.json punch ${candidate.id} has an invalid verification status`);
    }
  });
}

function validateSettings(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("project.json settings must be an object");
  }
  const settings = value as Partial<{
    proof_sensitivity: unknown;
    pause_threshold_seconds: unknown;
    acx_target_rms_dbfs: unknown;
    teleprompter_theme: unknown;
    teleprompter_font_size: unknown;
    teleprompter_highlight: unknown;
  }>;
  if (settings.proof_sensitivity !== undefined && !["conservative", "default", "aggressive"].includes(settings.proof_sensitivity as string)) {
    throw new Error("project.json settings have an invalid proof sensitivity");
  }
  if (settings.pause_threshold_seconds !== undefined && (!Number.isFinite(settings.pause_threshold_seconds) || (settings.pause_threshold_seconds as number) < 2 || (settings.pause_threshold_seconds as number) > 12)) {
    throw new Error("project.json settings have an invalid pause threshold");
  }
  if (settings.acx_target_rms_dbfs !== undefined && (!Number.isFinite(settings.acx_target_rms_dbfs) || (settings.acx_target_rms_dbfs as number) < -23 || (settings.acx_target_rms_dbfs as number) > -18)) {
    throw new Error("project.json settings have an invalid ACX target");
  }
  if (settings.teleprompter_theme !== undefined && !["dark", "sepia", "cream"].includes(settings.teleprompter_theme as string)) {
    throw new Error("project.json settings have an invalid teleprompter theme");
  }
  if (settings.teleprompter_font_size !== undefined && (!Number.isFinite(settings.teleprompter_font_size) || (settings.teleprompter_font_size as number) < 20 || (settings.teleprompter_font_size as number) > 96)) {
    throw new Error("project.json settings have an invalid teleprompter font size");
  }
  if (settings.teleprompter_highlight !== undefined && !["word", "line", "paragraph"].includes(settings.teleprompter_highlight as string)) {
    throw new Error("project.json settings have an invalid teleprompter highlight");
  }
}

function isAudioPath(value: unknown): value is string {
  return isPathInDirectory(value, "audio");
}

function isManuscriptPath(value: unknown): value is string {
  return isPathInDirectory(value, "manuscript/chapters");
}

function isAlignmentPath(value: unknown): value is string {
  return isPathInDirectory(value, "alignment");
}

function isNotesPath(value: unknown): value is string {
  return isPathInDirectory(value, "notes");
}

function isPathInDirectory(value: unknown, directory: string): value is string {
  if (!isSafeProjectPath(value)) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/").toLocaleLowerCase("en-US");
  return normalized.startsWith(`${directory.toLocaleLowerCase("en-US")}/`);
}

function isSafeProjectPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-z]:[\\/]/iu.test(value)) {
    return false;
  }
  const segments = value.split(/[\\/]/u);
  return !value.includes("\0") && segments.every((segment) =>
    segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !/[<>:"|?*\u0000-\u001F]/u.test(segment)
    && !/[ .]$/u.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment),
  );
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value);
}

function isSeatMap(value: unknown): value is Record<Seat, SeatDefinition> {
  if (!value || typeof value !== "object") {
    return false;
  }

  for (const seat of ["narration", "N1", "N2"] as const) {
    const definition = (value as Record<string, unknown>)[seat];
    if (!definition || typeof definition !== "object") {
      return false;
    }
    const candidate = definition as Partial<SeatDefinition>;
    if (typeof candidate.label !== "string" || typeof candidate.color !== "string") {
      return false;
    }
  }

  return true;
}
