const fs = require("node:fs/promises");
const path = require("node:path");
const { writeJsonAtomic } = require("./file-utils.cjs");

const saves = new Map();

function validate(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.chapters)) {
    throw new Error("Invalid project metadata");
  }
  return value;
}

async function readValid(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Project metadata must be a regular file");
  }
  return validate(JSON.parse(await fs.readFile(file, "utf8")));
}

async function readProjectJson(file) {
  try {
    return await readValid(file);
  } catch {
    return readValid(`${file}.previous`);
  }
}

function saveProjectJson(file, value) {
  // Capture the requested revision now, before an older queued save finishes.
  const snapshot = validate(JSON.parse(JSON.stringify(value)));
  const key = path.resolve(file);
  const task = (saves.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
    let previous;
    try {
      previous = await readProjectJson(file);
    } catch (error) {
      try {
        await fs.lstat(file);
      } catch (statError) {
        if (statError.code === "ENOENT") {
          await writeJsonAtomic(file, snapshot);
          return;
        }
        throw statError;
      }
      throw error;
    }
    await writeJsonAtomic(`${file}.previous`, previous);
    await writeJsonAtomic(file, snapshot);
  });
  saves.set(key, task);
  const clear = () => {
    if (saves.get(key) === task) {
      saves.delete(key);
    }
  };
  task.then(clear, clear);
  return task;
}

module.exports = { saveProjectJson, readProjectJson };
