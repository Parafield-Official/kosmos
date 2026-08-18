const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

function absoluteFolder(folder) {
  if (typeof folder !== "string" || !path.isAbsolute(folder)) {
    throw new Error("Project folder must be an absolute path");
  }
  return path.resolve(folder);
}

/** Verify that an IPC folder is a real Booth Desk project, not a symlink. */
async function assertProjectFolder(folder) {
  const root = absoluteFolder(folder);
  const folderStat = await fs.lstat(root);
  if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) {
    throw new Error("Project folder must be a regular directory, not a symbolic link");
  }
  const projectStat = await fs.lstat(path.join(root, "project.json"));
  if (!projectStat.isFile() || projectStat.isSymbolicLink()) {
    throw new Error("Project folder must contain a regular project.json file");
  }
  return root;
}

/**
 * Create a project root for a new project/temporary seat pack without ever
 * accepting a symlink in the root itself.
 */
async function ensureProjectRoot(folder) {
  const root = absoluteFolder(folder);
  try {
    const stat = await fs.lstat(root);
    assertRegularDirectory(stat, "Project folder");
    return root;
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
    try {
      await fs.mkdir(root);
    } catch (mkdirError) {
      if (!mkdirError || mkdirError.code !== "EEXIST") {
        throw mkdirError;
      }
    }
    const stat = await fs.lstat(root);
    assertRegularDirectory(stat, "Project folder");
    return root;
  }
}

/** Create a project-relative directory while checking every component. */
async function ensureProjectDirectory(folder, relativePath) {
  const root = await ensureProjectRoot(folder);
  if (relativePath === undefined || relativePath === "" || relativePath === ".") {
    return root;
  }
  const resolved = projectAssetPath(root, relativePath);
  let current = root;
  for (const component of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      assertRegularDirectory(stat, "Project asset directory");
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        if (!mkdirError || mkdirError.code !== "EEXIST") {
          throw mkdirError;
        }
      }
      const stat = await fs.lstat(current);
      assertRegularDirectory(stat, "Project asset directory");
    }
  }
  return resolved;
}

/** Resolve a project-relative path without following any symlink component. */
function projectAssetPath(folder, relativePath) {
  const root = absoluteFolder(folder);
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error("Project asset path must be a non-empty relative path");
  }
  const portableRelative = relativePath.replaceAll("\\", path.sep);
  const segments = portableRelative.split(path.sep);
  if (segments.some((segment) => segment === ".." || segment.length === 0)) {
    throw new Error("Project asset path must not contain empty or parent components");
  }
  const resolved = path.resolve(root, portableRelative);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Project asset path leaves the project folder");
  }

  // A lexical containment check does not stop `audio/` (or the selected root)
  // from being a symlink to a private file outside the project.
  assertNotSymlink(root);
  let current = root;
  const components = path.relative(root, resolved).split(path.sep).filter(Boolean);
  for (const component of components) {
    current = path.join(current, component);
    try {
      assertNotSymlink(current);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  return resolved;
}

/** Resolve a project audio asset without exposing manuscript/project files. */
function projectAudioPath(folder, relativePath) {
  if (typeof relativePath !== "string" || !/^audio\//iu.test(relativePath.replaceAll("\\", "/"))) {
    throw new Error("Audio asset path must be inside the project audio folder");
  }
  return projectAssetPath(folder, relativePath);
}

function assertRegularDirectory(stat, label) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory, not a symbolic link`);
  }
}

function assertNotSymlink(candidate) {
  if (fsSync.lstatSync(candidate).isSymbolicLink()) {
    throw new Error("Project asset path cannot traverse a symbolic link");
  }
}

module.exports = {
  assertProjectFolder,
  ensureProjectDirectory,
  ensureProjectRoot,
  projectAudioPath,
  projectAssetPath,
};
