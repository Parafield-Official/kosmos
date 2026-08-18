const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const { Zip, ZipPassThrough } = require("fflate");

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

  const temporaryPath = `${outputPath}.part-${process.pid}-${Date.now()}`;
  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  let needsDrain = false;
  let zipFailure = null;
  const finished = new Promise((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });
  const archiveRoot = safeArchiveRoot(path.basename(folder));
  const zip = new Zip((error, data, final) => {
    if (error) {
      zipFailure = error;
      output.destroy(error);
      return;
    }
    if (data.length > 0 && !output.write(Buffer.from(data))) {
      needsDrain = true;
    }
    if (final) {
      output.end();
    }
  });

  try {
    for (const relativePath of relativePaths) {
      const safeRelative = safeRelativePath(relativePath);
      const absolutePath = path.resolve(folder, safeRelative);
      if (!absolutePath.startsWith(`${path.resolve(folder)}${path.sep}`)) {
        throw new Error(`Project file leaves the project folder: ${relativePath}`);
      }
      const stat = await fsp.lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symbolic links are not included in collaborator packs: ${relativePath}`);
      }
      if (!stat.isFile()) {
        continue;
      }

      const entry = new ZipPassThrough(`${archiveRoot}/${safeRelative.replaceAll(path.sep, "/")}`);
      entry.mtime = stat.mtime;
      zip.add(entry);
      for await (const chunk of fs.createReadStream(absolutePath)) {
        entry.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), false);
        if (needsDrain) {
          await once(output, "drain");
          needsDrain = false;
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
    await fsp.rename(temporaryPath, outputPath);
    const stat = await fsp.stat(outputPath);
    return { outputPath, fileCount: relativePaths.length, bytes: stat.size };
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
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe project path: ${value}`);
  }
  return normalized;
}

function safeArchiveRoot(value) {
  const clean = value.replace(/[\\/:*?"<>|]/g, "-").trim();
  return clean || "Booth Desk Project.booth";
}

module.exports = { zipProjectFolder };
