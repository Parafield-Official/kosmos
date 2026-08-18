const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Zip, ZipPassThrough } = require("fflate");
const { replaceFile } = require("./file-utils.cjs");

/**
 * Stream a project archive using ZIP's store mode. Audiobook files are already
 * compressed or enormous, so this avoids a full-book memory spike and avoids
 * wasting CPU recompressing them.
 */
async function zipProjectFolder({ folder, outputPath, relativePaths }) {
  if (!path.isAbsolute(folder) || !path.isAbsolute(outputPath)) {
    throw new Error("Project and archive paths must be absolute");
  }
  if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
    throw new Error("A collaborator archive needs at least one file");
  }
  await fsp.access(path.join(folder, "project.json"));
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  // Validate and stat every requested entry before opening the destination.
  // An invalid path or a directory-only selection should fail without ever
  // creating a write stream that then has to be destroyed during open.
  const root = path.resolve(folder);
  const files = [];
  for (const relativePath of [...new Set(relativePaths)]) {
    const safeRelative = safeRelativePath(relativePath);
    const absolutePath = path.resolve(folder, safeRelative);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Project file leaves the project folder: ${relativePath}`);
    }
    const stat = await fsp.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symbolic links are not included in collaborator packs: ${relativePath}`);
    }
    if (stat.isFile()) {
      files.push({ safeRelative, absolutePath, stat });
    }
  }
  if (files.length === 0) {
    throw new Error("A collaborator archive needs at least one regular file");
  }

  const temporaryPath = `${outputPath}.part-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  let drainPromise = null;
  let zipFailure = null;
  let fileCount = 0;
  const finished = new Promise((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });
  // The cleanup path can run before the stream has opened. Attach a rejection
  // handler immediately so a late open/error event never becomes an unhandled
  // rejection after the caller has already received the original failure.
  finished.catch(() => undefined);
  const archiveRoot = safeArchiveRoot(path.basename(folder));
  const zip = new Zip((error, data, final) => {
    if (error) {
      zipFailure = error;
      output.destroy(error);
      return;
    }
    if (data.length > 0 && !output.write(Buffer.from(data))) {
      // fflate may invoke the callback several times before the consumer has
      // drained. Keep one waiter instead of overwriting it on every chunk;
      // otherwise a large audiobook can outrun the file stream and retain the
      // whole archive in memory.
      if (!drainPromise) {
        drainPromise = waitForDrain(output);
      }
    }
    if (final) {
      output.end();
    }
  });

  try {
    for (const { safeRelative, absolutePath, stat } of files) {
      const entry = new ZipPassThrough(`${archiveRoot}/${safeRelative.replaceAll(path.sep, "/")}`);
      entry.mtime = stat.mtime;
      zip.add(entry);
      fileCount += 1;
      for await (const chunk of fs.createReadStream(absolutePath)) {
        entry.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), false);
        if (drainPromise) {
          await drainPromise;
          drainPromise = null;
        }
        if (zipFailure) {
          throw zipFailure;
        }
      }
      entry.push(new Uint8Array(0), true);
    }
    zip.end();
    await finished;
    if (zipFailure) {
      throw zipFailure;
    }
    await replaceFile(temporaryPath, outputPath);
    const stat = await fsp.stat(outputPath);
    return { outputPath, fileCount, bytes: stat.size };
  } catch (error) {
    zip.terminate();
    output.destroy();
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    throw new Error(`Unsafe project path: ${String(value)}`);
  }
  const slashNormalized = value.replaceAll("\\", "/");
  const segments = slashNormalized.split("/");
  if (
    slashNormalized.startsWith("/")
    || /^[a-z]:\//iu.test(slashNormalized)
    || slashNormalized.includes("\0")
    || segments.some((segment) => segment.length === 0 || segment === "..")
  ) {
    throw new Error(`Unsafe project path: ${value}`);
  }
  const safeSegments = segments.filter((segment) => segment !== ".");
  if (safeSegments.length === 0) {
    throw new Error(`Unsafe project path: ${value}`);
  }
  return safeSegments.join("/");
}

function safeArchiveRoot(value) {
  const clean = value.replace(/[\\/:*?"<>|]/g, "-").trim();
  return clean || "Kosmos Project";
}

/** Wait for writable backpressure without leaving the losing listener behind. */
function waitForDrain(output) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      output.removeListener("drain", onDrain);
      output.removeListener("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    output.once("drain", onDrain);
    output.once("error", onError);
  });
}

module.exports = { waitForDrain, zipProjectFolder };
