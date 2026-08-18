import {
  PROJECT_SCHEMA,
  type AuthorStatus,
  type ChapterFile,
  type ProjectFile,
  type ProjectMode,
  type Seat,
  type SeatDefinition,
} from "./types";

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
  patch: Partial<Pick<ProjectFile, "name" | "mode" | "author" | "narrator_n1" | "narrator_n2" | "people" | "seats">>,
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
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    throw new Error("project.json is missing a name");
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
  if (!Array.isArray(candidate.people)) {
    throw new Error("project.json people must be an array");
  }
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
