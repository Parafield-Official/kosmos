import type { ChapterNote, Pickup, ProjectFile, AuthorStatus, PickupStatus } from "./types";

const AUTHOR_ONLY_STATUSES = new Set<AuthorStatus>([
  "needs_pickup",
  "approved",
  "ignore_this_flag",
]);

export interface NoteOptions {
  id?: string;
  now?: string;
}

/** A DIY narrator can approve only when they are also listed as an author. */
export function canApproveChapters(project: ProjectFile, actorName: string): boolean {
  return project.people.some(
    (person) => person.role === "author" && samePerson(person.name, actorName),
  );
}

export function canAddAuthorNotes(project: ProjectFile, actorName: string): boolean {
  return canApproveChapters(project, actorName);
}

/**
 * Check a local identity against the shared role roster before it is written.
 * The folder is not an authentication system, but this prevents a narrator
 * from accidentally self-promoting to author (or changing an existing
 * person's role) just by opening the collaboration panel.
 *
 * An empty roster is the deliberate bootstrap case: the first person may
 * choose author or narrator. New narrators may join an existing project; a
 * new author may join only when no author has been recorded yet.
 */
export function canClaimIdentity(
  project: ProjectFile,
  personName: string,
  role: "author" | "narrator",
): boolean {
  const cleanName = personName.trim();
  if (cleanName.length === 0) {
    return false;
  }
  const existing = project.people.find((person) => samePerson(person.name, cleanName));
  if (existing) {
    return existing.role === role;
  }
  if (role === "author") {
    return !project.people.some((person) => person.role === "author");
  }
  return true;
}

/** Set a chapter's author-facing workflow state with an explicit role check. */
export function setChapterAuthorStatus(
  project: ProjectFile,
  chapterId: string,
  status: AuthorStatus,
  actorName: string,
  now = new Date().toISOString(),
): ProjectFile {
  if (!(["draft", "needs_pickup", "approved", "ignore_this_flag"] as const).includes(status)) {
    throw new Error(`Unknown chapter author status: ${String(status)}`);
  }
  if (AUTHOR_ONLY_STATUSES.has(status) && !canApproveChapters(project, actorName)) {
    throw new Error("Only a person with the author role can set author status");
  }
  const chapter = project.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  return {
    ...project,
    chapters: project.chapters.map((candidate) =>
      candidate.id === chapterId
        ? { ...candidate, author_status: status, updated_at: now }
        : candidate,
    ),
    updated_at: now,
  };
}

/** Add an author note to the shared project folder. */
export function addChapterNote(
  project: ProjectFile,
  chapterId: string,
  actorName: string,
  body: string,
  options: NoteOptions = {},
): ProjectFile {
  if (!canAddAuthorNotes(project, actorName)) {
    throw new Error("Only a person with the author role can add author notes");
  }
  if (!project.chapters.some((chapter) => chapter.id === chapterId)) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  const cleanBody = body.trim();
  if (cleanBody.length === 0) {
    throw new Error("Chapter note cannot be empty");
  }
  const now = options.now ?? new Date().toISOString();
  const note: ChapterNote = {
    id: options.id ?? `note-${randomId()}`,
    chapter_id: chapterId,
    author: actorName.trim(),
    body: cleanBody,
    created_at: now,
  };
  return {
    ...project,
    chapter_notes: [...(project.chapter_notes ?? []), note],
    updated_at: now,
  };
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Attach a short, plain-text explanation to a proof pickup. */
export function addPickupNote(pickup: Pickup, note: string): Pickup {
  const clean = note.trim();
  if (clean.length === 0) {
    throw new Error("Pickup note cannot be empty");
  }
  return { ...pickup, note: clean };
}

export function updatePickup(
  pickup: Pickup,
  changes: { status?: PickupStatus; note?: string },
): Pickup {
  const next = { ...pickup };
  if (changes.status) {
    if (!(["open", "done", "ignored"] as const).includes(changes.status)) {
      throw new Error(`Unknown pickup status: ${String(changes.status)}`);
    }
    next.status = changes.status;
  }
  if (changes.note !== undefined) {
    return addPickupNote(next, changes.note);
  }
  return next;
}

function samePerson(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase("en-US") === right.trim().toLocaleLowerCase("en-US");
}
