const fs = require("node:fs");
const path = require("node:path");

/** Resolve a bundled runtime first, then a contributor-provided override/PATH. */
function resolveRuntimeBinary({
  name,
  envVar,
  resourcesPath,
  appPath,
  cwd = process.cwd(),
  platform = process.platform,
  env = process.env,
}) {
  const extension = platform === "win32" ? ".exe" : "";
  const candidates = [
    envVar ? env[envVar] : undefined,
    resourcesPath && path.join(resourcesPath, "bin", `${name}${extension}`),
    resourcesPath && path.join(resourcesPath, `${name}${extension}`),
    appPath && path.join(appPath, "vendor", "bin", `${name}${extension}`),
    appPath && path.join(appPath, "vendor", `${name}${extension}`),
    cwd && path.join(cwd, "vendor", "bin", `${name}${extension}`),
    cwd && path.join(cwd, "vendor", `${name}${extension}`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue to the next bundled or configured location.
    }
  }

  // Let the operating system resolve a system installation when no bundled
  // binary is present. This keeps source builds useful and fails clearly when
  // a release was packaged without its runtime assets.
  return name;
}

module.exports = { resolveRuntimeBinary };
