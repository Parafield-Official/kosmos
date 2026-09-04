const fs = require("node:fs/promises");
const path = require("node:path");
const { copyFileAtomic } = require("./file-utils.cjs");

/**
 * Copy a regular manuscript into a project without taking ownership of the
 * user's source document. The atomic destination replacement also avoids
 * exposing a partial project copy if the operation is interrupted.
 */
async function copyFileToDestination(source, dest) {
  if (typeof source !== "string" || source.length === 0 || !path.isAbsolute(source)) {
    throw new Error("Manuscript source must be an absolute path.");
  }
  if (typeof dest !== "string" || dest.length === 0 || !path.isAbsolute(dest)) {
    throw new Error("Manuscript destination must be an absolute path.");
  }
  const src = path.resolve(source);
  const dst = path.resolve(dest);
  if (src === dst) {
    return { ok: true, moved: false, copied: false };
  }

  const srcStat = await fs.lstat(src);
  if (!srcStat.isFile() || srcStat.isSymbolicLink()) {
    throw new Error("Manuscript must be a regular file.");
  }

  await copyFileAtomic(src, dst);
  return { ok: true, moved: false, copied: true };
}

module.exports = {
  copyFileToDestination,
  /** @deprecated Manuscript imports are copies; retained for compatibility. */
  moveFileToDestination: copyFileToDestination,
};
