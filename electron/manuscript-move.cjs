const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Move a regular file to dest. Same-volume uses rename; otherwise copy then
 * remove the source so the user is not left with two copies.
 */
async function moveFileToDestination(source, dest) {
  if (typeof source !== "string" || source.length === 0 || !path.isAbsolute(source)) {
    throw new Error("Manuscript source must be an absolute path.");
  }
  if (typeof dest !== "string" || dest.length === 0 || !path.isAbsolute(dest)) {
    throw new Error("Manuscript destination must be an absolute path.");
  }
  const src = path.resolve(source);
  const dst = path.resolve(dest);
  if (src === dst) {
    return { ok: true, moved: false };
  }

  const srcStat = await fs.lstat(src);
  if (!srcStat.isFile() || srcStat.isSymbolicLink()) {
    throw new Error("Manuscript must be a regular file.");
  }

  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rm(dst, { force: true });
  try {
    await fs.rename(src, dst);
    return { ok: true, moved: true };
  } catch {
    await fs.copyFile(src, dst);
    await fs.rm(src, { force: true });
    return { ok: true, moved: true };
  }
}

module.exports = { moveFileToDestination };
