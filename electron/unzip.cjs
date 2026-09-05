const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Unzip, UnzipInflate } = require("fflate");

const DEFAULT_MAX_ENTRIES = 20000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

/**
 * Unpack a collaborator archive into a folder we own.
 *
 * A pack arrives from someone else's machine, so every name is treated as
 * hostile: nothing may climb out of the destination, and an archive that
 * claims to hold more than a book is refused rather than filling the disk.
 * The source is read a chunk at a time and each chunk waits for its writes,
 * so a full audiobook does not have to fit in memory.
 */
async function extractArchive({
  archivePath,
  destination,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  if (!path.isAbsolute(archivePath) || !path.isAbsolute(destination)) {
    throw new Error("Archive and destination paths must be absolute");
  }
  await fsp.mkdir(destination, { recursive: true });

  const entries = [];
  let entryCount = 0;
  let totalBytes = 0;
  let failure = null;
  let pending = [];
  const openHandles = new Set();

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (failure) {
      return;
    }
    if (file.name.endsWith("/")) {
      return;
    }
    let safeName;
    try {
      safeName = safeEntryName(file.name);
    } catch (error) {
      failure = error;
      return;
    }
    entryCount += 1;
    if (entryCount > maxEntries) {
      failure = new Error(`This archive holds more than ${maxEntries} files.`);
      return;
    }
    const target = path.join(destination, safeName);
    let handle = null;
    const open = (async () => {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      handle = await fsp.open(target, "wx");
      openHandles.add(handle);
    })();
    pending.push(open);
    let written = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = failure ?? error;
        return;
      }
      if (failure) {
        return;
      }
      totalBytes += chunk.length;
      written += chunk.length;
      if (totalBytes > maxBytes) {
        failure = new Error("This archive unpacks to more than Kosmos will accept.");
        return;
      }
      const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      pending.push((async () => {
        await open;
        if (bytes.length > 0) {
          await handle.write(bytes);
        }
        if (final) {
          await handle.close();
          openHandles.delete(handle);
          handle = null;
        }
      })());
      if (final) {
        entries.push({ name: safeName, bytes: written });
      }
    };
    file.start();
  };

  const source = fs.createReadStream(archivePath, { highWaterMark: READ_CHUNK_BYTES });
  try {
    for await (const chunk of source) {
      unzip.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), false);
      await settle();
      if (failure) {
        throw failure;
      }
    }
    unzip.push(new Uint8Array(0), true);
    await settle();
    if (failure) {
      throw failure;
    }
  } catch (error) {
    source.destroy();
    await settle().catch(() => undefined);
    await closeOpenHandles();
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
  if (entries.length === 0) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw new Error("This archive has no files in it.");
  }
  return { destination, entries, bytes: totalBytes };

  async function settle() {
    while (pending.length > 0) {
      const waiting = pending;
      pending = [];
      await Promise.all(waiting);
    }
  }

  async function closeOpenHandles() {
    const handles = [...openHandles];
    openHandles.clear();
    await Promise.allSettled(handles.map((handle) => handle.close()));
  }
}

/** Names come from another machine; refuse anything that could escape. */
function safeEntryName(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("This archive has an unnamed file in it.");
  }
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/")
    || /^[a-z]:\//iu.test(normalized)
    || normalized.includes("\0")
  ) {
    throw new Error(`This archive holds an unsafe path: ${name}`);
  }
  const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new Error(`This archive holds an unsafe path: ${name}`);
  }
  return segments.join(path.sep);
}

module.exports = { extractArchive, safeEntryName };
