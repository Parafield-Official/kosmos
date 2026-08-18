const path = require("node:path");
const { resolveRuntimeBinary } = require("./runtime.cjs");
const { runCommand } = require("./process.cjs");

const MARKITDOWN_EXTENSIONS = new Set([".docx", ".epub", ".pdf"]);
const MARKITDOWN_TIMEOUT_MS = 10 * 60 * 1000;
const MARKITDOWN_MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

/**
 * Convert a rich manuscript through Microsoft's local MarkItDown CLI when it
 * is staged or explicitly installed. A null result means the caller should
 * use Kosmos's built-in offline parser instead.
 */
async function convertWithMarkItDown({
  sourcePath,
  extension = path.extname(sourcePath),
  resourcesPath,
  appPath,
  cwd = process.cwd(),
  env = process.env,
  requireBundled = false,
  resolveCommand = resolveRuntimeBinary,
  run = runCommand,
} = {}) {
  const normalizedExtension = String(extension).toLowerCase();
  if (!MARKITDOWN_EXTENSIONS.has(normalizedExtension)) {
    return null;
  }

  let command;
  try {
    command = resolveCommand({
      name: "markitdown",
      envVar: "MARKITDOWN_PATH",
      resourcesPath,
      appPath,
      cwd,
      env,
      requireBundled,
    });
  } catch {
    return null;
  }
  try {
    const output = await run(command, [sourcePath], {
      timeoutMs: MARKITDOWN_TIMEOUT_MS,
      maxOutputBytes: MARKITDOWN_MAX_OUTPUT_BYTES,
    });
    const markdown = Buffer.isBuffer(output) ? output.toString("utf8") : String(output ?? "");
    return markdown.replace(/^\uFEFF/u, "").trim().length > 0 ? markdown : null;
  } catch {
    return null;
  }
}

module.exports = {
  MARKITDOWN_EXTENSIONS,
  convertWithMarkItDown,
};
