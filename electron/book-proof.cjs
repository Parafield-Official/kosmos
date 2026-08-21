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
      checked: Boolean(alignment),
    });
  }
  return { chapters: entries };
}

const PICKUP_STATUSES = new Set(["open", "done", "ignored"]);

/**
 * Set one decision on the named flags of a chapter, leaving the rest of the
 * saved alignment alone. Reports whether anything actually changed so an
 * untouched chapter is not rewritten on disk.
 *
 * @param {object[]} pickups saved pickups for one chapter
 * @param {string[]} ids pickup ids to change
 * @param {"open" | "done" | "ignored"} status
 */
function applyPickupDecision(pickups, ids, status) {
  if (!PICKUP_STATUSES.has(status)) {
    throw new Error(`Unknown pickup status: ${String(status)}`);
  }
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  let changed = false;
  const next = (pickups ?? []).map((pickup) => {
    if (!wanted.has(pickup.id) || pickup.status === status) {
      return pickup;
    }
    changed = true;
    return { ...pickup, status };
  });
  return { pickups: next, changed };
}

/**
 * Apply a collaborator's decisions to saved flags: the status they set, and
 * the note they left with it. Anything they did not mention is untouched.
 *
 * @param {object[]} pickups saved pickups for one chapter
 * @param {Array<{ id: string, status?: string, note?: string }>} updates
 */
function applyPickupUpdates(pickups, updates) {
  const wanted = new Map();
  for (const update of Array.isArray(updates) ? updates : []) {
    if (update?.id) {
      wanted.set(update.id, update);
    }
  }
  let changed = false;
  const next = (pickups ?? []).map((pickup) => {
    const update = wanted.get(pickup.id);
    if (!update) {
      return pickup;
    }
    const decided = { ...pickup };
    if (update.status !== undefined) {
      if (!PICKUP_STATUSES.has(update.status)) {
        throw new Error(`Unknown pickup status: ${String(update.status)}`);
      }
      decided.status = update.status;
    }
    const note = typeof update.note === "string" ? update.note.trim() : "";
    if (note !== "") {
      decided.note = note;
    }
    if (decided.status === pickup.status && decided.note === pickup.note) {
      return pickup;
    }
    changed = true;
    return decided;
  });
  return { pickups: next, changed };
}

module.exports = { collectBookProof, applyPickupDecision, applyPickupUpdates };
