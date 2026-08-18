const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_NAME = "identities.json";

async function loadIdentity(userDataPath, projectId) {
  validateProjectId(projectId);
  try {
    const state = JSON.parse(await fs.readFile(path.join(userDataPath, FILE_NAME), "utf8"));
    const identity = state.projects?.[projectId];
    return identity ? { projectId, ...identity } : null;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveIdentity(userDataPath, identity) {
  validateIdentity(identity);
  await fs.mkdir(userDataPath, { recursive: true });
  const destination = path.join(userDataPath, FILE_NAME);
  let state = { schema: 1, projects: {} };
  try {
    state = JSON.parse(await fs.readFile(destination, "utf8"));
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
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
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporary, destination);
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
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error("Local identity needs a project id");
  }
}

module.exports = { loadIdentity, saveIdentity };
