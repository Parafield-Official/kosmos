const path = require("node:path");
const { projectAssetPath, ensureProjectDirectory } = require("./project-path.cjs");
const { writeFileAtomic } = require("./file-utils.cjs");

/**
 * Writing the pages a narrator reads from: the guide of every name with how to
 * say it, and the script with those pronunciations dropped in beside the names.
 *
 * What the files contain is decided in the shared core; this module gathers the
 * scripts off disk and writes the result, and is kept out of the Electron shell
 * so the gathering and writing can be tested.
 *
 * `hooks` supplies:
 *   readChapterDocument(folder, chapter) -> { spans }
 *   core: the shared glossary module
 */
async function exportVoiceGuide({ folder, project, frequency, hooks }) {
  const chapters = await collectChapterTexts({ folder, project, hooks });
  const files = hooks.core.planVoiceGuideFiles(
    {
      projectName: project.title ?? project.name,
      narrator: project.narrator,
      glossary: project.glossary ?? [],
      chapters,
    },
    { frequency: frequency === "all" ? "all" : "paragraph" },
  );
  const outputFolder = await ensureProjectDirectory(folder, "export/voice-guide");
  for (const file of files) {
    await writeFileAtomic(
      projectAssetPath(folder, path.relative(folder, path.join(outputFolder, file.fileName))),
      file.contents,
      "utf8",
    );
  }
  return { folder: outputFolder, files: files.map((file) => file.fileName) };
}

/**
 * Read every chapter script as plain text. A chapter with no readable script is
 * left out rather than stopping the export: a narrator waiting on a guide should
 * not be blocked by one missing file.
 */
async function collectChapterTexts({ folder, project, hooks }) {
  const chapters = [];
  for (const chapter of project.chapters ?? []) {
    if (!chapter.text_path) {
      continue;
    }
    try {
      const document = await hooks.readChapterDocument(folder, chapter);
      chapters.push({
        index: chapter.index,
        title: chapter.title,
        text: (document.spans ?? []).map((span) => span.text).join(""),
      });
    } catch {
      // Keep going; the rest of the book still exports.
    }
  }
  return chapters;
}

module.exports = { exportVoiceGuide, collectChapterTexts };
