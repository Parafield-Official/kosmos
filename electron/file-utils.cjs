const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Write a UTF-8 JSON document without exposing a partially-written target.
 *
 * The random temporary suffix matters here: several renderer actions can be
 * in flight at once (for example, a pickup save and a settings save). A
 * process-only suffix lets those writes trample each other's temporary file.
 */
async function writeJsonAtomic(destination, value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error("Cannot write undefined JSON");
  }
  await writeFileAtomic(destination, `${serialized}\n`, "utf8");
}

/** Write a file through a same-directory temporary and a final rename. */
async function writeFileAtomic(destination, data, encoding) {
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.writeFile(temporary, data, encoding ? { encoding } : undefined);
    await replaceFile(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Copy through a private temporary so an existing destination symlink can
 * never redirect the copy outside the project. */
async function copyFileAtomic(source, destination) {
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.copyFile(source, temporary);
    await replaceFile(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

/**
 * Rename a file while tolerating an existing destination on platforms where
 * rename does not replace regular files (notably some Windows configurations).
 */
async function replaceFile(source, destination) {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (!error || (error.code !== "EEXIST" && error.code !== "EPERM" && error.code !== "ENOTEMPTY")) {
      throw error;
    }
    const backup = `${destination}.backup-${process.pid}-${crypto.randomUUID()}`;
    let movedOld = false;
    let backupRetained = false;
    try {
      try {
        await fs.rename(destination, backup);
        movedOld = true;
      } catch (backupError) {
        if (!backupError || backupError.code !== "ENOENT") {
          throw backupError;
        }
      }
      await fs.rename(source, destination);
      if (movedOld) {
        try {
          await fs.rm(backup, { force: true });
        } catch {
          // The new destination is valid. Keep the backup if cleanup is
          // temporarily blocked so a later recovery can still find it.
          backupRetained = true;
        }
      }
    } catch (replacementError) {
      if (movedOld) {
        try {
          await fs.access(destination);
          backupRetained = true;
        } catch {
          try {
            await fs.rename(backup, destination);
            movedOld = false;
          } catch {
            backupRetained = true;
          }
        }
      }
      throw replacementError;
    } finally {
      if (!backupRetained) {
        await fs.rm(backup, { force: true }).catch(() => undefined);
      }
    }
  }
}

/**
 * Replace a directory after all new contents have been prepared. The old
 * directory is kept until the new one is in place, and restored if the final
 * rename fails.
 */
async function replaceDirectory(staging, destination) {
  const backup = `${destination}.backup-${process.pid}-${crypto.randomUUID()}`;
  let movedOld = false;
  let backupRetained = false;
  try {
    try {
      await fs.rename(destination, backup);
      movedOld = true;
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }

    await fs.rename(staging, destination);
    if (movedOld) {
      try {
        await fs.rm(backup, { recursive: true, force: true });
      } catch {
        backupRetained = true;
      }
    }
  } catch (error) {
    // If the destination was moved aside and the new directory did not make
    // it into place, put the previous export back before surfacing the error.
    if (movedOld) {
      try {
        await fs.access(destination);
        backupRetained = true;
      } catch {
        try {
          await fs.rename(backup, destination);
          movedOld = false;
        } catch {
          backupRetained = true;
        }
      }
    }
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (!backupRetained) {
      await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** A readable, collision-resistant suffix for generated project assets. */
function assetStamp(date = new Date()) {
  const iso = date instanceof Date && !Number.isNaN(date.valueOf())
    ? date
    : new Date();
  const stamp = iso.toISOString().replace(/[^0-9]/g, "").slice(0, 17);
  return `${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Return the first available path, preserving the requested name when it is
 * unused and adding a numbered suffix when it already exists.
 */
async function nextAvailablePath(destination) {
  const extension = path.extname(destination);
  const stem = extension ? destination.slice(0, -extension.length) : destination;
  let candidate = destination;
  for (let suffix = 2; suffix <= 1000; suffix += 1) {
    try {
      await fs.access(candidate);
      candidate = `${stem}-${suffix}${extension}`;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return candidate;
      }
      throw error;
    }
  }
  return `${stem}-${crypto.randomUUID()}${extension}`;
}

/**
 * Copy a source into the first free destination while reserving the name
 * atomically. A check-then-copy sequence is racy when two renderer actions
 * finish together (for example, two imported takes with the same filename).
 */
async function copyFileUnique(source, destination) {
  const extension = path.extname(destination);
  const stem = extension ? destination.slice(0, -extension.length) : destination;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  for (let suffix = 0; suffix <= 1000; suffix += 1) {
    const candidate = suffix === 0 ? destination : `${stem}-${suffix + 1}${extension}`;
    let handle;
    let reserved = false;
    try {
      handle = await fs.open(candidate, "wx");
      reserved = true;
      await handle.close();
      handle = undefined;
      try {
        await fs.copyFile(source, candidate);
      } catch (error) {
        await fs.rm(candidate, { force: true });
        throw error;
      }
      return candidate;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (reserved) {
        await fs.rm(candidate, { force: true }).catch(() => undefined);
      }
      if (error && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
  const candidate = `${stem}-${crypto.randomUUID()}${extension}`;
  const handle = await fs.open(candidate, "wx");
  await handle.close();
  try {
    await fs.copyFile(source, candidate);
    return candidate;
  } catch (error) {
    await fs.rm(candidate, { force: true });
    throw error;
  }
}

module.exports = {
  assetStamp,
  copyFileAtomic,
  copyFileUnique,
  nextAvailablePath,
  replaceFile,
  replaceDirectory,
  writeFileAtomic,
  writeJsonAtomic,
};
