const path = require("node:path");

/**
 * Folders whose direct children changing should refresh the shelf:
 * the workspace itself, each immediate project (or in-progress) folder, and
 * any linked books kept outside the workspace.
 *
 * We never recurse into manuscript/audio so recording writes stay off this list.
 */
function collectShelfWatchTargets(workspace, childDirNames, externalPaths) {
  const targets = [];
  if (typeof workspace === "string" && workspace.length > 0) {
    const root = path.resolve(workspace);
    targets.push(root);
    for (const name of childDirNames || []) {
      if (typeof name !== "string" || name.length === 0 || name === "." || name === "..") {
        continue;
      }
      if (name.includes("/") || name.includes("\\")) {
        continue;
      }
      targets.push(path.join(root, name));
    }
  }
  for (const extra of externalPaths || []) {
    if (typeof extra === "string" && extra.length > 0) {
      targets.push(path.resolve(extra));
    }
  }
  return [...new Set(targets)];
}

/** Stable shelf fingerprint so the UI can skip no-op re-renders. */
function shelfIdentity(projects, workspace) {
  const books = (projects || []).map((project) =>
    [
      project.id ?? "",
      project.folder ?? "",
      project.title ?? "",
      project.author ?? "",
      project.external ? "1" : "0",
      project.coverDataUrl ? "1" : "0",
    ].join("\t"),
  );
  return `${workspace ?? ""}\n${books.join("\n")}`;
}

module.exports = { collectShelfWatchTargets, shelfIdentity };
