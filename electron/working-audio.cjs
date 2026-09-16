const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { copyFileAtomic } = require("./file-utils.cjs");
const {
  ensureProjectDirectory,
  projectAssetPath,
  projectAudioPath,
} = require("./project-path.cjs");

const execFileAsync = promisify(execFile);
const WORKING_DIRECTORY = ".kosmos/working";

function safeWorkingFileName(file) {
  if (
    typeof file !== "string"
    || file.length === 0
    || file === "."
    || file === ".."
    || file.includes("/")
    || file.includes("\\")
  ) {
    throw new Error("Working file must be a single file name.");
  }
  return file;
}

function isWorkingAudioFile(file) {
  return typeof file === "string" && /(?:^working|-working)(?:\.[^.]+)?$/iu.test(file);
}

function workingAudioPath(folder, file) {
  return projectAssetPath(folder, `${WORKING_DIRECTORY}/${safeWorkingFileName(file)}`);
}

function legacyWorkingAudioPath(folder, file) {
  return projectAudioPath(folder, `audio/${safeWorkingFileName(file)}`);
}

async function hideOnWindows(directory) {
  if (process.platform !== "win32") {
    return;
  }
  try {
    await execFileAsync("attrib", ["+H", directory], { windowsHide: true });
  } catch (error) {
    // A hidden folder is a presentation detail. The leading-dot path still
    // keeps it out of Finder, and audio itself remains free of working files.
    console.warn(`[working-audio] could not hide internal directory: ${error?.message ?? error}`);
  }
}

async function ensureWorkingAudioDirectory(folder) {
  const directory = await ensureProjectDirectory(folder, WORKING_DIRECTORY);
  await hideOnWindows(projectAssetPath(folder, ".kosmos"));
  await hideOnWindows(directory);
  return directory;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Existing projects stored the editing buffer in `audio/`. Move it aside on
 * first use so opening an old book cannot leave a third user-facing asset.
 */
async function migrateLegacyWorkingAudio(folder, file) {
  const destination = workingAudioPath(folder, file);
  if (await exists(destination)) {
    return destination;
  }
  const legacy = legacyWorkingAudioPath(folder, file);
  if (!(await exists(legacy))) {
    return destination;
  }
  await ensureWorkingAudioDirectory(folder);
  await copyFileAtomic(legacy, destination);
  await fs.rm(legacy, { force: true });
  return destination;
}

module.exports = {
  ensureWorkingAudioDirectory,
  isWorkingAudioFile,
  migrateLegacyWorkingAudio,
  workingAudioPath,
};
