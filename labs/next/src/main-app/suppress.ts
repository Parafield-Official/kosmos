/**
 * Per-book “never flag this word”. Align and live flags reuse the original
 * suppressor; the list lives on the book, not in app-wide Settings.
 */

import { isSuppressedPickup, normalizeSuppressedWords } from "../../../../src/core/proof/align";
import { normalizeProjectSettings } from "../../../../src/core/project/settings";
import type { BookProject, ChapterPickup } from "./store";

export function normalizeSuppressedList(value: unknown): string[] {
  return normalizeProjectSettings({ suppressed_words: value }).suppressed_words;
}

export function suppressLabel(pickup: Pick<ChapterPickup, "expected" | "heard">): string {
  return (pickup.expected || pickup.heard).trim();
}

export function pickupIsSuppressed(
  pickup: Pick<ChapterPickup, "expected" | "heard" | "kind">,
  words: readonly string[] | undefined,
): boolean {
  return isSuppressedPickup(pickup, normalizeSuppressedWords(words));
}

export function dropSuppressedPickups(
  pickups: ChapterPickup[] | undefined,
  words: readonly string[] | undefined,
): ChapterPickup[] | undefined {
  if (!pickups?.length) {
    return pickups;
  }
  const kept = pickups.filter((pickup) => !pickupIsSuppressed(pickup, words));
  return kept.length === pickups.length ? pickups : kept;
}

export function addSuppressedWord(project: BookProject, word: string): BookProject {
  const trimmed = word.trim();
  if (!trimmed) {
    return project;
  }
  const suppressedWords = normalizeSuppressedList([...(project.suppressedWords ?? []), trimmed]);
  return {
    ...project,
    suppressedWords,
    chapters: project.chapters.map((chapter) => ({
      ...chapter,
      pickups: dropSuppressedPickups(chapter.pickups, suppressedWords),
    })),
  };
}

export function removeSuppressedWord(project: BookProject, word: string): BookProject {
  const key = word.trim().toLocaleLowerCase("en-US");
  const suppressedWords = (project.suppressedWords ?? []).filter(
    (entry) => entry.trim().toLocaleLowerCase("en-US") !== key,
  );
  return { ...project, suppressedWords };
}

export function reorderSuppressedWords(project: BookProject, ordered: string[]): BookProject {
  const current = project.suppressedWords ?? [];
  if (ordered.length !== current.length) {
    return project;
  }
  return { ...project, suppressedWords: ordered };
}
