const { convertWithMarkItDown } = require("./markitdown.cjs");
const { runCommand } = require("./process.cjs");
const { resolveRuntimeBinary } = require("./runtime.cjs");

const PDF_TEXT_MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

/**
 * Extract readable PDF text in the main process. MarkItDown is preferred
 * because it preserves useful Markdown structure; pdftotext is the local
 * fallback for searchable PDFs that MarkItDown cannot convert.
 */
async function extractPdfText({
  sourcePath,
  resourcesPath,
  appPath,
  cwd = process.cwd(),
  env = process.env,
  requireBundled = false,
  convert = convertWithMarkItDown,
  resolveCommand = resolveRuntimeBinary,
  run = runCommand,
} = {}) {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    throw new Error("A PDF source path is required.");
  }

  const markdown = await convert({
    sourcePath,
    extension: ".pdf",
    resourcesPath,
    appPath,
    cwd,
    env,
    requireBundled,
  });
  if (typeof markdown === "string" && markdown.trim().length > 0) {
    return markdown;
  }

  try {
    const command = resolveCommand({
      name: "pdftotext",
      envVar: "PDFTOTEXT_PATH",
      resourcesPath,
      appPath,
      cwd,
      env,
      // MarkItDown is mandatory in packaged builds. pdftotext remains an
      // optional local fallback, so an installed copy may still help if the
      // bundled converter cannot read a particular searchable PDF.
      requireBundled: false,
    });
    const output = await run(command, ["-layout", sourcePath, "-"], {
      maxOutputBytes: PDF_TEXT_MAX_OUTPUT_BYTES,
    });
    const text = Buffer.isBuffer(output) ? output.toString("utf8") : String(output ?? "");
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

module.exports = { extractPdfText, PDF_TEXT_MAX_OUTPUT_BYTES };
