/**
 * Whole-book proof collection.
 *
 * A question such as "how was this name read everywhere else" cannot be
 * answered from the open chapter, and the renderer has no filesystem of its
 * own. The readers are injected so this ordering and fallback behaviour can be
 * tested without booting Electron.
 */

/**
 * @param {object} project saved project envelope
 * @param {(chapter: object) => Promise<{ text?: string } | null>} readDocument
 * @param {(chapterId: string) => Promise<{ transcript?: object[]; pickups?: object[] } | null>} readAlignment
 */
async function collectBookProof(project, readDocument, readAlignment) {
  const chapters = [...(project?.chapters ?? [])].sort((a, b) => a.index - b.index);
  const entries = [];
  for (const chapter of chapters) {
    // One chapter with a missing or broken script must not sink the whole
    // scan; it simply has no text to search.
    let document = null;
    if (chapter.text_path) {
      try {
        document = await readDocument(chapter);
      } catch {
        document = null;
      }
    }
    let alignment = null;
    try {
      alignment = await readAlignment(chapter.id);
    } catch {
      alignment = null;
    }
    entries.push({
      chapterId: chapter.id,
      chapterIndex: chapter.index,
      chapterTitle: chapter.title,
      manuscript: document?.text ?? "",
      transcript: alignment?.transcript ?? [],
      pickups: alignment?.pickups ?? [],
      hasAudio: Boolean(chapter.audio_path),
    });
  }
  return { chapters: entries };
}

module.exports = { collectBookProof };
