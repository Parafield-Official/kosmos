import type {
  AuthorStatus,
  ChapterNote,
  GlossaryEntry,
  Pickup,
  PickupStatus,
  ProjectFile,
} from "../project/types";

/** What the caller found in the incoming pack for one chapter. */
export interface IncomingChapterFacts {
  chapterId: string;
  title: string;
  index: number;
  authorStatus?: AuthorStatus;
  /** Their chapter's last save time, used only to break a tie on status. */
  updatedAt?: string;
  /** True when their script text differs from ours. */
  scriptDiffers?: boolean;
  /** Their attached recording, relative to their project folder. */
  audioPath?: string;
  /** Their saved proof pass, if they ran one. */
  hasAlignment?: boolean;
  pickups?: Pickup[];
}

export interface MergeInput {
  local: ProjectFile;
  incoming: ProjectFile;
  incomingChapters: IncomingChapterFacts[];
  /** Saved pickups on this machine, by chapter id. */
  localPickups?: Record<string, Pickup[]>;
  /** Chapters that already have a saved proof pass here. */
  localAlignedChapters?: string[];
}

export interface PickupDecision {
  chapterId: string;
  pickupId: string;
  status: PickupStatus;
  note?: string;
}

export interface AudioAdoption {
  chapterId: string;
  chapterTitle: string;
  relativePath: string;
  /** Whether their proof pass comes with it. */
  withAlignment: boolean;
}

export type MergeConflict =
  | { kind: "pickup"; chapterId: string; chapterTitle: string; pickupId: string; expected: string; mine: PickupStatus; theirs: PickupStatus }
  | { kind: "audio"; chapterId: string; chapterTitle: string; mine: string; theirs: string }
  | { kind: "script"; chapterId: string; chapterTitle: string }
  | { kind: "status"; chapterId: string; chapterTitle: string; mine: AuthorStatus; theirs: AuthorStatus };

export interface MergePlan {
  notesToAdd: ChapterNote[];
  glossaryToAdd: GlossaryEntry[];
  glossaryRespells: Array<{ id: string; spelling: string; respell: string }>;
  decisions: PickupDecision[];
  statusChanges: Array<{ chapterId: string; chapterTitle: string; from: AuthorStatus; to: AuthorStatus }>;
  audioToAdopt: AudioAdoption[];
  conflicts: MergeConflict[];
  skipped: {
    /** Chapters they have that this project does not. */
    unknownChapters: string[];
    /** Their flags that do not line up with any of ours. */
    unknownPickups: number;
    /** Notes about chapters this project does not have. */
    orphanNotes: number;
  };
  /** True when the plan would not change anything. */
  empty: boolean;
}

/**
 * Work out what a collaborator's pack would change here, without changing
 * anything yet.
 *
 * Two people editing the same book offline will disagree, and silently taking
 * one side is how work disappears. Every clear addition is planned, and every
 * genuine disagreement is reported so a person decides.
 */
export function planProjectMerge(input: MergeInput): MergePlan {
  if (input.local.id !== input.incoming.id) {
    throw new Error("That pack belongs to a different book.");
  }
  const localChapters = new Map(input.local.chapters.map((chapter) => [chapter.id, chapter]));
  const localPickups = input.localPickups ?? {};
  const aligned = new Set(input.localAlignedChapters ?? []);
  const plan: MergePlan = {
    notesToAdd: [],
    glossaryToAdd: [],
    glossaryRespells: [],
    decisions: [],
    statusChanges: [],
    audioToAdopt: [],
    conflicts: [],
    skipped: { unknownChapters: [], unknownPickups: 0, orphanNotes: 0 },
    empty: true,
  };

  for (const incoming of input.incomingChapters) {
    const local = localChapters.get(incoming.chapterId);
    if (!local) {
      plan.skipped.unknownChapters.push(incoming.title);
      continue;
    }
    if (incoming.scriptDiffers) {
      plan.conflicts.push({ kind: "script", chapterId: local.id, chapterTitle: local.title });
    }

    if (incoming.audioPath && !local.audio_path) {
      plan.audioToAdopt.push({
        chapterId: local.id,
        chapterTitle: local.title,
        relativePath: incoming.audioPath,
        withAlignment: Boolean(incoming.hasAlignment),
      });
    } else if (incoming.audioPath && local.audio_path && incoming.audioPath !== local.audio_path) {
      plan.conflicts.push({
        kind: "audio",
        chapterId: local.id,
        chapterTitle: local.title,
        mine: local.audio_path,
        theirs: incoming.audioPath,
      });
    }

    const mine = new Map((localPickups[local.id] ?? []).map((pickup) => [pickup.id, pickup]));
    const adoptingWholesale = Boolean(incoming.hasAlignment) && !aligned.has(local.id);
    for (const theirs of incoming.pickups ?? []) {
      if (adoptingWholesale) {
        // Their whole proof pass is being taken, so individual decisions come
        // with it rather than being planned one by one.
        continue;
      }
      const ours = mine.get(theirs.id);
      if (!ours) {
        plan.skipped.unknownPickups += 1;
        continue;
      }
      if (ours.status === theirs.status && (theirs.note ?? "") === (ours.note ?? "")) {
        continue;
      }
      const untouchedHere = ours.status === "open" && !ours.note;
      if (untouchedHere) {
        plan.decisions.push({
          chapterId: local.id,
          pickupId: theirs.id,
          status: theirs.status,
          note: theirs.note,
        });
        continue;
      }
      if (theirs.status !== ours.status && theirs.status !== "open") {
        plan.conflicts.push({
          kind: "pickup",
          chapterId: local.id,
          chapterTitle: local.title,
          pickupId: theirs.id,
          expected: ours.expected,
          mine: ours.status,
          theirs: theirs.status,
        });
      }
    }

    const theirStatus = incoming.authorStatus;
    if (theirStatus && theirStatus !== local.author_status) {
      if (isNewer(incoming.updatedAt, local.updated_at)) {
        plan.statusChanges.push({
          chapterId: local.id,
          chapterTitle: local.title,
          from: local.author_status,
          to: theirStatus,
        });
      } else {
        plan.conflicts.push({
          kind: "status",
          chapterId: local.id,
          chapterTitle: local.title,
          mine: local.author_status,
          theirs: theirStatus,
        });
      }
    }
  }

  const knownNotes = new Set((input.local.chapter_notes ?? []).map((note) => note.id));
  for (const note of input.incoming.chapter_notes ?? []) {
    if (knownNotes.has(note.id)) {
      continue;
    }
    if (!localChapters.has(note.chapter_id)) {
      plan.skipped.orphanNotes += 1;
      continue;
    }
    plan.notesToAdd.push(note);
  }

  const localGlossary = new Map(
    (input.local.glossary ?? []).map((entry) => [glossaryKey(entry.spelling), entry]),
  );
  const localGlossaryIds = new Set((input.local.glossary ?? []).map((entry) => entry.id));
  for (const entry of input.incoming.glossary ?? []) {
    const existing = localGlossary.get(glossaryKey(entry.spelling));
    if (!existing) {
      plan.glossaryToAdd.push({
        ...entry,
        // Two machines can mint the same id for different words; keep ours
        // unique so an addition never lands on an existing entry.
        id: localGlossaryIds.has(entry.id) ? `${entry.id}-in` : entry.id,
      });
      continue;
    }
    const respell = entry.respell?.trim();
    if (respell && !existing.respell?.trim()) {
      plan.glossaryRespells.push({ id: existing.id, spelling: existing.spelling, respell });
    }
  }

  plan.empty = plan.notesToAdd.length === 0
    && plan.glossaryToAdd.length === 0
    && plan.glossaryRespells.length === 0
    && plan.decisions.length === 0
    && plan.statusChanges.length === 0
    && plan.audioToAdopt.length === 0;
  return plan;
}

/**
 * Fold the planned additions into the project file. Audio and proof passes are
 * copied by the caller; this records the references once those files are in
 * place.
 */
export function applyMergePlan(
  local: ProjectFile,
  plan: MergePlan,
  options: { now?: string; alignmentPathFor?: (chapterId: string) => string | undefined } = {},
): ProjectFile {
  const now = options.now ?? new Date().toISOString();
  const audioByChapter = new Map(plan.audioToAdopt.map((entry) => [entry.chapterId, entry]));
  const statusByChapter = new Map(plan.statusChanges.map((entry) => [entry.chapterId, entry.to]));

  const chapters = local.chapters.map((chapter) => {
    const audio = audioByChapter.get(chapter.id);
    const status = statusByChapter.get(chapter.id);
    if (!audio && !status) {
      return chapter;
    }
    const next = { ...chapter, updated_at: now };
    if (audio) {
      next.audio_path = audio.relativePath;
      if (audio.withAlignment) {
        const alignmentPath = options.alignmentPathFor?.(chapter.id);
        if (alignmentPath) {
          next.pickups_path = alignmentPath;
        }
      }
    }
    if (status) {
      next.author_status = status;
    }
    return next;
  });

  const glossary = [...(local.glossary ?? [])].map((entry) => {
    const respell = plan.glossaryRespells.find((candidate) => candidate.id === entry.id);
    return respell ? { ...entry, respell: respell.respell } : entry;
  });

  return {
    ...local,
    chapters,
    glossary: [...glossary, ...plan.glossaryToAdd],
    chapter_notes: [...(local.chapter_notes ?? []), ...plan.notesToAdd]
      .sort((left, right) => left.created_at.localeCompare(right.created_at)),
    updated_at: now,
  };
}

/** A one-line, plain description of what an import would do. */
export function describeMergePlan(plan: MergePlan): string {
  if (plan.empty && plan.conflicts.length === 0) {
    return "Nothing in this pack is new here.";
  }
  const parts: string[] = [];
  if (plan.audioToAdopt.length > 0) {
    parts.push(`${plan.audioToAdopt.length} ${plan.audioToAdopt.length === 1 ? "recording" : "recordings"}`);
  }
  if (plan.decisions.length > 0) {
    parts.push(`${plan.decisions.length} flag ${plan.decisions.length === 1 ? "decision" : "decisions"}`);
  }
  if (plan.notesToAdd.length > 0) {
    parts.push(`${plan.notesToAdd.length} ${plan.notesToAdd.length === 1 ? "note" : "notes"}`);
  }
  if (plan.glossaryToAdd.length + plan.glossaryRespells.length > 0) {
    const count = plan.glossaryToAdd.length + plan.glossaryRespells.length;
    parts.push(`${count} pronunciation ${count === 1 ? "entry" : "entries"}`);
  }
  if (plan.statusChanges.length > 0) {
    parts.push(`${plan.statusChanges.length} chapter ${plan.statusChanges.length === 1 ? "status" : "statuses"}`);
  }
  const lead = parts.length > 0 ? `Brings ${joinList(parts)}.` : "Brings nothing new.";
  if (plan.conflicts.length === 0) {
    return lead;
  }
  return `${lead} ${plan.conflicts.length} ${plan.conflicts.length === 1 ? "disagreement needs" : "disagreements need"} your decision.`;
}

function joinList(parts: string[]): string {
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function isNewer(theirs: string | undefined, mine: string | undefined): boolean {
  if (!theirs) {
    return false;
  }
  if (!mine) {
    return true;
  }
  const theirTime = Date.parse(theirs);
  const myTime = Date.parse(mine);
  if (!Number.isFinite(theirTime) || !Number.isFinite(myTime)) {
    return false;
  }
  return theirTime > myTime;
}

function glossaryKey(spelling: string): string {
  return spelling.trim().toLocaleLowerCase("en-US");
}
