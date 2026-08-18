import type { ProjectFile } from "../project/types";

export interface SharePackOptions {
  lightPack: boolean;
}

/**
 * Choose files for a collaborator archive. Local identity and VCS metadata
 * never leave the machine. A light pack also drops generated exports and raw
 * takes that are not the chapter's currently attached audio.
 */
export function planSharePaths(
  project: ProjectFile,
  availablePaths: string[],
  options: SharePackOptions,
): string[] {
  const referencedAudio = new Set<string>();
  for (const chapter of project.chapters) {
    if (chapter.audio_path) {
      referencedAudio.add(normalizeSafePath(chapter.audio_path));
    }
  }
  for (const entry of project.glossary ?? []) {
    if (entry.clip_path) {
      referencedAudio.add(normalizeSafePath(entry.clip_path));
    }
  }

  return availablePaths
    .map(normalizeSafePath)
    .filter((relativePath) => !isLocalOnlyPath(relativePath))
    .filter((relativePath) => {
      if (!options.lightPack) {
        return true;
      }
      if (relativePath === "export" || relativePath.startsWith("export/")) {
        return false;
      }
      if (isRawAudioPath(relativePath) && !referencedAudio.has(relativePath)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => left.localeCompare(right, "en"));
}

function normalizeSafePath(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Unsafe project path: path must be a non-empty string");
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/")
    || /^[a-z]:\//i.test(normalized)
    || segments.some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Unsafe project path: ${value}`);
  }
  return normalized;
}

function isLocalOnlyPath(relativePath: string): boolean {
  const fileName = relativePath.split("/").at(-1)?.toLocaleLowerCase("en-US") ?? "";
  return relativePath === ".git"
    || relativePath.startsWith(".git/")
    || relativePath === ".svn"
    || relativePath.startsWith(".svn/")
    || fileName === ".ds_store"
    || fileName === "thumbs.db"
    || fileName === "local.me"
    || fileName === "me.json";
}

function isRawAudioPath(relativePath: string): boolean {
  return relativePath.startsWith("audio/")
    && (/(?:^|[/_-])raw(?:[/_.-]|$)/i.test(relativePath) || /_raw\.[^/]+$/i.test(relativePath));
}
