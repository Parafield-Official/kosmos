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
  const addReferenced = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0) {
      referencedAudio.add(normalizeSafePath(value));
    }
  };
  for (const chapter of project.chapters) {
    addReferenced(chapter.audio_path);
    addReferenced(chapter.raw_audio_path);
    addReferenced(chapter.edited_audio_path);
    addReferenced(chapter.bed_audio_path);
    addReferenced(chapter.overdub_audio_path);
    addReferenced(chapter.duet_mix_path);
    addReferenced(chapter.n1_stem_path);
    addReferenced(chapter.n2_stem_path);
  }
  for (const entry of project.glossary ?? []) {
    addReferenced(entry.clip_path);
  }
  addReferenced(project.room_test_path);
  for (const punch of project.punch_recordings ?? []) {
    addReferenced(punch.path);
    addReferenced(punch.edited_path);
  }

  return Array.from(new Set(availablePaths.map(normalizeSafePath)))
    .filter((relativePath) => !isLocalOnlyPath(relativePath) && !isTransientPath(relativePath))
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
    || normalized.includes("\0")
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

/** Atomic writes and failed exports can leave recovery artifacts in a folder.
 * They are implementation details, not collaborator data, and including one
 * can make a ZIP look like a second project or leak a stale manuscript copy.
 */
function isTransientPath(relativePath: string): boolean {
  return relativePath.split("/").some((segment) =>
    segment.startsWith(".acx-staging-")
    || segment.includes(".tmp-")
    || segment.includes(".backup-")
    || segment.includes(".part-"),
  );
}

function isRawAudioPath(relativePath: string): boolean {
  return relativePath.startsWith("audio/")
    && (/(?:^|[/_-])raw(?:[/_.-]|$)/i.test(relativePath) || /_raw\.[^/]+$/i.test(relativePath));
}
