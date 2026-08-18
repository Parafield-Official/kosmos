const fs = require("node:fs/promises");
const path = require("node:path");
const { writeJsonAtomic } = require("./file-utils.cjs");

const FILE_NAME = "identities.json";
const saveQueues = new Map();

async function loadIdentity(userDataPath, projectId) {
  validateProjectId(projectId);
  try {
    const state = JSON.parse(await fs.readFile(path.join(userDataPath, FILE_NAME), "utf8"));
    if (!state || typeof state !== "object" || !state.projects || typeof state.projects !== "object" || Array.isArray(state.projects)) {
      return null;
    }
    const identity = state.projects[projectId];
    if (!identity) {
      return null;
    }
    const candidate = { projectId, ...identity };
    try {
      validateIdentity(candidate);
      return candidate;
    } catch {
      // A hand-edited or interrupted local cache must never leak an invalid
      // role/seat into the shared project UI.
      return null;
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveIdentity(userDataPath, identity) {
  validateIdentity(identity);
  const destination = path.join(userDataPath, FILE_NAME);
  const previous = saveQueues.get(destination) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => saveIdentityUnlocked(userDataPath, destination, identity));
  saveQueues.set(destination, task);
  try {
    return await task;
  } finally {
    if (saveQueues.get(destination) === task) {
      saveQueues.delete(destination);
    }
  }
}

async function saveIdentityUnlocked(userDataPath, destination, identity) {
  await fs.mkdir(userDataPath, { recursive: true });
  let state = { schema: 1, projects: {} };
  try {
    state = JSON.parse(await fs.readFile(destination, "utf8"));
  } catch (error) {
    if (!error || (error.code !== "ENOENT" && error.name !== "SyntaxError")) {
      throw error;
    }
  }
  if (
    !state
    || typeof state !== "object"
    || Array.isArray(state)
    || !state.projects
    || typeof state.projects !== "object"
    || Array.isArray(state.projects)
  ) {
    state = { schema: 1, projects: {} };
  }
  const next = {
    schema: 1,
    projects: {
      ...(state.projects ?? {}),
      [identity.projectId]: {
        personName: identity.personName.trim(),
        role: identity.role,
        ...(identity.seat ? { seat: identity.seat } : {}),
      },
    },
  };
  await writeJsonAtomic(destination, next);
  return { projectId: identity.projectId, ...next.projects[identity.projectId] };
}

function validateIdentity(identity) {
  if (!identity || typeof identity !== "object") {
    throw new Error("A local identity is required");
  }
  validateProjectId(identity.projectId);
  if (typeof identity.personName !== "string" || identity.personName.trim().length === 0) {
    throw new Error("Local identity needs a person name");
  }
  if (identity.role !== "author" && identity.role !== "narrator") {
    throw new Error("Local identity role must be author or narrator");
  }
  if (identity.seat !== undefined && identity.seat !== "N1" && identity.seat !== "N2") {
    throw new Error("Narrator seat must be N1 or N2");
  }
}

function validateProjectId(projectId) {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(projectId)) {
    throw new Error("Local identity needs a project id");
  }
}

module.exports = { loadIdentity, saveIdentity };
