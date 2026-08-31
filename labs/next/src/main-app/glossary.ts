/**
 * Per-book pronunciation list for Labs. Detection and CRUD come from the
 * original glossary engine; resolve-once lives here. The booth can open a
 * cheatsheet of words that already have a guide or clip; recording does not wait.
 */

import type { GlossaryEntry } from "../../../../src/core/project/types";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  extractGlossaryCandidates,
  mergeGlossaryCandidates,
  parsePronouncingDictionary,
  renameGlossaryEntry,
} from "../../../../src/core/glossary/candidates";
import { fillGlossaryRespells } from "../../../../src/core/glossary/guide";
import { paragraphsFromHtml } from "./booth";
import { readChapterContent, type BookProject } from "./store";

export type BookGlossary = {
  entries: GlossaryEntry[];
  dismissed: string[];
};

export function spellingKey(spelling: string): string {
  return spelling.trim().toLocaleLowerCase("en-US");
}

export function isResolved(entry: GlossaryEntry): boolean {
  return Boolean(entry.respell?.trim() || entry.clip_path);
}

/** Whole-word count, including possessives — same rule as the original voice guide. */
export function spellingCount(text: string, spelling: string): number {
  const trimmed = spelling.trim();
  if (!trimmed || !text) {
    return 0;
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|['\u2019]s\\b|[^\\p{L}\\p{N}])`,
    "giu",
  );
  return [...text.matchAll(pattern)].length;
}

export function spellingInText(text: string, spelling: string): boolean {
  return spellingCount(text, spelling) > 0;
}

export function dismissedSet(dismissed: string[] | undefined): Set<string> {
  return new Set((dismissed ?? []).map(spellingKey).filter(Boolean));
}

export function bookGlossary(project: BookProject): BookGlossary {
  return {
    entries: project.glossary ?? [],
    dismissed: project.glossaryDismissed ?? [],
  };
}

export function entriesInText(entries: GlossaryEntry[], text: string): GlossaryEntry[] {
  return entries.filter((entry) => spellingInText(text, entry.spelling));
}

export function unresolvedInText(entries: GlossaryEntry[], text: string): GlossaryEntry[] {
  return entriesInText(entries, text).filter((entry) => !isResolved(entry));
}

export function resolvedInText(entries: GlossaryEntry[], text: string): GlossaryEntry[] {
  return entriesInText(entries, text).filter(isResolved);
}

export function scanGlossaryFromManuscript(
  project: BookProject,
  manuscript: string,
): BookProject {
  const dismissed = dismissedSet(project.glossaryDismissed);
  const candidates = extractGlossaryCandidates(manuscript).filter(
    (candidate) => !dismissed.has(spellingKey(candidate.spelling)),
  );
  const existing = (project.glossary ?? []).filter(
    (entry) => !dismissed.has(spellingKey(entry.spelling)),
  );
  return {
    ...project,
    glossary: mergeGlossaryCandidates(existing, candidates),
    glossaryDismissed: [...dismissed],
  };
}

/** Fill glossary for books that were saved before pronunciation scanning existed. */
export async function ensureBookGlossary(project: BookProject): Promise<BookProject | null> {
  if (project.glossary !== undefined || project.chapters.length === 0) {
    return null;
  }
  const texts: string[] = [];
  for (const chapter of project.chapters) {
    const html = await readChapterContent(project, chapter.id);
    texts.push(paragraphsFromHtml(html).join("\n"));
    await yieldPaint();
  }
  await yieldPaint();
  return scanGlossaryFromManuscript(project, texts.join("\n\n"));
}

function yieldPaint(): Promise<void> {
  return new Promise((resolve) => {
    const later = () => window.setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(later);
      return;
    }
    later();
  });
}

export function addGlossaryWord(
  project: BookProject,
  spelling: string,
  respell?: string,
): BookProject {
  const clean = spelling.trim();
  if (!clean) {
    return project;
  }
  const key = spellingKey(clean);
  const dismissed = [...dismissedSet(project.glossaryDismissed)].filter((item) => item !== key);
  const existing = (project.glossary ?? []).find((entry) => spellingKey(entry.spelling) === key);
  if (existing) {
    return {
      ...project,
      glossary: renameGlossaryEntry(
        project.glossary ?? [],
        existing.id,
        existing.spelling,
        respell ?? existing.respell,
        existing.voice_note,
      ),
      glossaryDismissed: dismissed,
    };
  }
  return {
    ...project,
    glossary: addGlossaryEntry(project.glossary ?? [], clean, { respell }),
    glossaryDismissed: dismissed,
  };
}

export function setGlossaryRespell(project: BookProject, id: string, respell: string): BookProject {
  const entry = (project.glossary ?? []).find((item) => item.id === id);
  if (!entry) {
    return project;
  }
  return {
    ...project,
    glossary: renameGlossaryEntry(project.glossary ?? [], id, entry.spelling, respell, entry.voice_note),
  };
}

export function setGlossaryClip(project: BookProject, id: string, clipPath: string | undefined): BookProject {
  return {
    ...project,
    glossary: (project.glossary ?? []).map((entry) => (entry.id === id ? { ...entry, clip_path: clipPath } : entry)),
  };
}

/** Move a subset of glossary rows (flagged or saved) without shuffling the other set. */
export function reorderGlossarySubset(project: BookProject, orderedIds: string[]): BookProject {
  const ids = new Set(orderedIds);
  const byId = new Map((project.glossary ?? []).map((entry) => [entry.id, entry]));
  const moved = orderedIds.map((id) => byId.get(id)).filter((entry): entry is GlossaryEntry => Boolean(entry));
  if (moved.length === 0) {
    return project;
  }
  let index = 0;
  return {
    ...project,
    glossary: (project.glossary ?? []).map((entry) => (ids.has(entry.id) ? moved[index++] ?? entry : entry)),
  };
}

export async function fillGlossaryFromDictionary(
  glossary: GlossaryEntry[],
): Promise<{ glossary: GlossaryEntry[]; filled: number; unknown: string[]; reason?: string }> {
  if (window.kosmosNext?.suggestGlossaryRespells) {
    try {
      const result = await window.kosmosNext.suggestGlossaryRespells({ glossary });
      if (result?.ok !== false) {
        return {
          glossary: result?.glossary ?? glossary,
          filled: result?.filled ?? 0,
          unknown: result?.unknown ?? [],
        };
      }
      if (result.reason && !result.reason.includes("not bundled")) {
        return { glossary, filled: 0, unknown: [], reason: result.reason };
      }
    } catch {
      // Hosted dictionary below.
    }
  }
  try {
    const response = await fetch("/cmudict.dict");
    if (!response.ok) {
      return { glossary, filled: 0, unknown: [], reason: "The dictionary is not available here." };
    }
    const lexicon = parsePronouncingDictionary(await response.text());
    const result = fillGlossaryRespells(glossary, lexicon);
    return { glossary: result.glossary, filled: result.filled, unknown: result.unknown };
  } catch {
    return { glossary, filled: 0, unknown: [], reason: "The dictionary is not available here." };
  }
}

/** Remove this word from the list and never flag it again in later chapters. */
export function dismissGlossaryWord(project: BookProject, id: string): BookProject {
  const entry = (project.glossary ?? []).find((item) => item.id === id);
  if (!entry) {
    return project;
  }
  const dismissed = dismissedSet(project.glossaryDismissed);
  dismissed.add(spellingKey(entry.spelling));
  return {
    ...project,
    glossary: deleteGlossaryEntry(project.glossary ?? [], id),
    glossaryDismissed: [...dismissed].sort((left, right) => left.localeCompare(right)),
  };
}
