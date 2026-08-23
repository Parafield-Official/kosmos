/** Validate and clamp a recorder punch range to the decoded source duration. */
function normalizePunchBounds(start, end, duration, toleranceSeconds = 0.01) {
  if (
    !Number.isFinite(start)
    || !Number.isFinite(end)
    || !Number.isFinite(duration)
    || duration <= 0
    || end <= start
    || start < 0
    || start >= duration
    || end > duration + Math.max(0, toleranceSeconds)
  ) {
    throw new Error("Punch boundaries must stay inside the attached take");
  }
  const boundedStart = Math.min(duration, Math.max(0, start));
  const boundedEnd = Math.min(duration, Math.max(boundedStart, end));
  if (boundedEnd <= boundedStart) {
    throw new Error("Punch boundaries must contain audio from the attached take");
  }
  return { start: boundedStart, end: boundedEnd };
}

/** One chapter owns one durable full-length edited render. */
function canonicalEditedPath(chapter) {
  const index = Number(chapter?.index);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("A chapter index is required for its edited recording");
  }
  return `audio/${String(index).padStart(2, "0")}_edited.wav`;
}

/**
 * Rebuild the working edit by replaying its small pickup clips in acceptance
 * order. Each pickup's seconds belong to the timeline produced by the entries
 * before it, which lets later corrections remain correctly placed even when an
 * earlier replacement changed the chapter duration.
 */
async function rebuildPunchTimeline({
  original,
  punches,
  sampleRate,
  loadReplacement,
  splicePunch,
}) {
  if (!(original instanceof Float32Array) || original.length === 0) {
    throw new Error("The original chapter recording contains no audio");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("A valid sample rate is required to rebuild an edited chapter");
  }
  if (!Array.isArray(punches) || typeof loadReplacement !== "function" || typeof splicePunch !== "function") {
    throw new Error("A pickup manifest, loader, and splice function are required");
  }

  let edited = new Float32Array(original);
  for (const punch of punches) {
    const bounds = normalizePunchBounds(
      punch?.t_start,
      punch?.t_end,
      edited.length / sampleRate,
    );
    const replacement = await loadReplacement(punch);
    if (!(replacement instanceof Float32Array) || replacement.length === 0) {
      throw new Error(`Pickup ${String(punch?.id ?? "recording")} contains no audio`);
    }
    edited = splicePunch({
      original: edited,
      replacement,
      sampleRate,
      startSeconds: bounds.start,
      endSeconds: bounds.end,
      crossfadeMs: 10,
    });
    if (!(edited instanceof Float32Array) || edited.length === 0) {
      throw new Error(`Pickup ${String(punch?.id ?? "recording")} produced an empty edited chapter`);
    }
  }
  return edited;
}

/** Build equally framed before/after audio without changing files or project state. */
function buildPunchPreview({
  current,
  replacement,
  sampleRate,
  startSeconds,
  endSeconds,
  contextSeconds = 3,
  splicePunch,
}) {
  if (!(current instanceof Float32Array) || current.length === 0) {
    throw new Error("The current chapter recording contains no audio");
  }
  if (!(replacement instanceof Float32Array) || replacement.length === 0) {
    throw new Error("The pickup recording contains no audio");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || typeof splicePunch !== "function") {
    throw new Error("A valid sample rate and splice function are required to preview a pickup");
  }

  const bounds = normalizePunchBounds(
    startSeconds,
    endSeconds,
    current.length / sampleRate,
  );
  const context = Number.isFinite(contextSeconds) ? Math.max(0, contextSeconds) : 3;
  const patched = splicePunch({
    original: current,
    replacement,
    sampleRate,
    startSeconds: bounds.start,
    endSeconds: bounds.end,
    crossfadeMs: 10,
  });
  if (!(patched instanceof Float32Array) || patched.length === 0) {
    throw new Error("The pickup preview contains no audio");
  }

  const contextStart = Math.max(0, Math.floor((bounds.start - context) * sampleRate));
  const currentEnd = Math.min(
    current.length,
    Math.ceil((bounds.end + context) * sampleRate),
  );
  const lengthDelta = patched.length - current.length;
  const patchedEnd = Math.min(patched.length, Math.max(contextStart, currentEnd + lengthDelta));

  return {
    currentContext: current.slice(contextStart, currentEnd),
    patchedContext: patched.slice(contextStart, patchedEnd),
  };
}

module.exports = {
  buildPunchPreview,
  canonicalEditedPath,
  normalizePunchBounds,
  rebuildPunchTimeline,
};
