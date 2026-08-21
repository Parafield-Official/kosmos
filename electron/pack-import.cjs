const fs = require("node:fs/promises");
const path = require("node:path");
const { projectAssetPath, ensureProjectDirectory } = require("./project-path.cjs");
const { copyFileUnique, writeJsonAtomic } = require("./file-utils.cjs");
const { applyPickupUpdates } = require("./book-proof.cjs");

/**
 * Reading and applying a collaborator's pack.
 *
 * Sharing a book was one way: a pack could be sent, but whatever came back
 * had to be re-entered by hand. The rules for what a pack may change live in
 * the shared core; this module does the reading, copying and writing, and is
 * kept apart from the Electron shell so the whole round trip can be tested.
 *
 * `hooks` supplies the project-level reads and writes:
 *   readAlignment(root, project, chapterId)
 *   saveAlignment(folder, project, chapterId, pickups, transcript) -> { project }
 *   saveProject(folder, project) -> { folder, project }
 *   readChapterDocument(root, chapter)
 *   validateIncomingProject(project)
 *   core: the shared sharing module
 */
async function reviewPack({ folder, project, stagingPath, hooks }) {
  const incomingRoot = await findPackProjectRoot(stagingPath);
  const incomingProject = await readIncomingProject(incomingRoot, hooks);
  const { plan } = await buildPlan({ folder, project, incomingRoot, incomingProject, hooks });
  return {
    plan,
    summary: hooks.core.describeMergePlan(plan),
    incomingRoot,
    incomingProject,
    incomingName: incomingProject.name,
  };
}

/** Copy in what the plan describes, re-read from disk rather than trusted. */
async function applyPack({ folder, project, stagingPath, hooks }) {
  const incomingRoot = await findPackProjectRoot(stagingPath);
  const incomingProject = await readIncomingProject(incomingRoot, hooks);
  const { plan } = await buildPlan({ folder, project, incomingRoot, incomingProject, hooks });

  let current = project;
  const alignmentPaths = new Map();
  const recordings = [];

  for (const adoption of plan.audioToAdopt) {
    const chapter = (current.chapters ?? []).find((candidate) => candidate.id === adoption.chapterId);
    if (!chapter) {
      continue;
    }
    const destination = await copyFileUnique(
      projectAssetPath(incomingRoot, adoption.relativePath),
      projectAssetPath(folder, adoption.relativePath),
    );
    adoption.relativePath = toProjectRelative(folder, destination);
    recordings.push(adoption.relativePath);
    if (!adoption.withAlignment) {
      continue;
    }
    const theirAlignment = await hooks.readAlignment(incomingRoot, incomingProject, adoption.chapterId)
      .catch(() => null);
    if (!theirAlignment) {
      adoption.withAlignment = false;
      continue;
    }
    const relativePath = chapter.pickups_path
      || `alignment/${String(chapter.index).padStart(2, "0")}.json`;
    await ensureProjectDirectory(folder, path.dirname(relativePath));
    await writeJsonAtomic(projectAssetPath(folder, relativePath), {
      schema: 1,
      chapter_id: adoption.chapterId,
      updated_at: new Date().toISOString(),
      transcript: theirAlignment.transcript,
      pickups: theirAlignment.pickups,
    });
    alignmentPaths.set(adoption.chapterId, relativePath);
  }

  for (const entry of plan.glossaryToAdd) {
    if (!entry.clip_path) {
      continue;
    }
    try {
      const destination = await copyFileUnique(
        projectAssetPath(incomingRoot, entry.clip_path),
        projectAssetPath(folder, entry.clip_path),
      );
      entry.clip_path = toProjectRelative(folder, destination);
    } catch {
      // A pronunciation is still worth keeping without its clip.
      delete entry.clip_path;
    }
  }

  const byChapter = new Map();
  for (const decision of plan.decisions) {
    const updates = byChapter.get(decision.chapterId) ?? [];
    updates.push({ id: decision.pickupId, status: decision.status, note: decision.note });
    byChapter.set(decision.chapterId, updates);
  }
  let decidedChapters = 0;
  for (const [chapterId, updates] of byChapter) {
    const alignment = await hooks.readAlignment(folder, current, chapterId).catch(() => null);
    if (!alignment) {
      continue;
    }
    const applied = applyPickupUpdates(alignment.pickups, updates);
    if (!applied.changed) {
      continue;
    }
    const saved = await hooks.saveAlignment(
      folder,
      current,
      chapterId,
      applied.pickups,
      alignment.transcript,
    );
    current = saved.project;
    decidedChapters += 1;
  }

  const merged = hooks.core.applyMergePlan(current, plan, {
    alignmentPathFor: (chapterId) => alignmentPaths.get(chapterId),
  });
  const saved = await hooks.saveProject(folder, merged);
  return {
    ...saved,
    applied: {
      recordings: recordings.length,
      decisions: plan.decisions.length,
      decidedChapters,
      notes: plan.notesToAdd.length,
      glossary: plan.glossaryToAdd.length + plan.glossaryRespells.length,
      statuses: plan.statusChanges.length,
      conflicts: plan.conflicts.length,
    },
  };
}

async function buildPlan({ folder, project, incomingRoot, incomingProject, hooks }) {
  const localPickups = {};
  const localAlignedChapters = [];
  for (const chapter of project.chapters ?? []) {
    const alignment = await hooks.readAlignment(folder, project, chapter.id).catch(() => null);
    if (!alignment) {
      continue;
    }
    localPickups[chapter.id] = alignment.pickups;
    localAlignedChapters.push(chapter.id);
  }

  const incomingChapters = [];
  for (const chapter of incomingProject.chapters ?? []) {
    const local = (project.chapters ?? []).find((candidate) => candidate.id === chapter.id);
    const alignment = chapter.pickups_path
      ? await hooks.readAlignment(incomingRoot, incomingProject, chapter.id).catch(() => null)
      : null;
    incomingChapters.push({
      chapterId: chapter.id,
      title: chapter.title,
      index: chapter.index,
      authorStatus: chapter.author_status,
      updatedAt: chapter.updated_at,
      scriptDiffers: local
        ? await chapterTextDiffers(folder, local, incomingRoot, chapter, hooks)
        : false,
      audioPath: chapter.audio_path,
      hasAlignment: Boolean(alignment),
      pickups: alignment?.pickups ?? [],
    });
  }

  return {
    plan: hooks.core.planProjectMerge({
      local: project,
      incoming: incomingProject,
      incomingChapters,
      localPickups,
      localAlignedChapters,
    }),
  };
}

async function readIncomingProject(incomingRoot, hooks) {
  const incomingProject = JSON.parse(
    await fs.readFile(projectAssetPath(incomingRoot, "project.json"), "utf8"),
  );
  hooks.validateIncomingProject(incomingProject);
  return incomingProject;
}

/**
 * Our own packs nest the project one folder down, but a pack that has been
 * re-zipped, or zipped along with the folder it was filed in, sits deeper.
 * Look a few levels down before giving up.
 */
const MAX_PACK_DEPTH = 4;

async function findPackProjectRoot(stagingPath) {
  const queue = [{ directory: stagingPath, depth: 0 }];
  while (queue.length > 0) {
    const { directory, depth } = queue.shift();
    try {
      const stat = await fs.lstat(path.join(directory, "project.json"));
      if (stat.isFile() && !stat.isSymbolicLink()) {
        return directory;
      }
    } catch {
      // Look one level deeper.
    }
    if (depth >= MAX_PACK_DEPTH) {
      continue;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
      }
    }
  }
  throw new Error("That .zip does not contain a Kosmos project.");
}

/**
 * A pack recorded against a different script cannot be trusted to line up with
 * ours, so the difference is reported rather than merged quietly.
 */
async function chapterTextDiffers(folder, localChapter, incomingRoot, incomingChapter, hooks) {
  if (!incomingChapter.text_path || !localChapter.text_path) {
    return false;
  }
  try {
    const mine = await hooks.readChapterDocument(folder, localChapter);
    const theirs = await hooks.readChapterDocument(incomingRoot, incomingChapter);
    return plainText(mine) !== plainText(theirs);
  } catch {
    return false;
  }
}

function plainText(document) {
  return (document?.spans ?? []).map((span) => span.text).join("").trim();
}

function toProjectRelative(folder, absolutePath) {
  return path.relative(folder, absolutePath).replaceAll(path.sep, "/");
}

module.exports = { applyPack, findPackProjectRoot, reviewPack };
