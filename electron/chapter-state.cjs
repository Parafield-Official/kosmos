/**
 * Pure chapter-reference transitions shared by the desktop workflow.
 * Keeping these decisions outside main.cjs makes stale duet/solo references
 * easy to test without booting Electron.
 */

/**
 * Clear proof and derived-audio references after replacing the canonical take.
 * Duet bed/overdub tracks are cleared by default because they are tied to the
 * previous take; callers that are updating one duet track can preserve them.
 */
function resetChapterAudioFields(chapter, { preserveDuetTracks = false } = {}) {
  const next = {
    ...resetChapterProofFields(chapter),
    edited_audio_path: undefined,
    duet_mix_path: undefined,
    n1_stem_path: undefined,
    n2_stem_path: undefined,
    acx_traffic_light: undefined,
  };
  if (!preserveDuetTracks) {
    next.bed_audio_path = undefined;
    next.overdub_audio_path = undefined;
  }
  return next;
}

/** Drop duet-only references while retaining a valid solo take, if present. */
function resetChapterDuetFields(chapter) {
  return {
    ...chapter,
    bed_audio_path: undefined,
    overdub_audio_path: undefined,
    duet_mix_path: undefined,
    n1_stem_path: undefined,
    n2_stem_path: undefined,
  };
}

/** Clear proof data whose timing/seat mapping belongs to an older script/take. */
function resetChapterProofFields(chapter) {
  return {
    ...chapter,
    pickups_path: chapter.pickups_path
      || `alignment/${String(chapter.index).padStart(2, "0")}.json`,
    open_pickups: 0,
  };
}

/**
 * Seat/script changes or replacing a source track alter which audio should be
 * audible, so an existing duet mix and its stems are no longer trustworthy.
 * Keep the bed and overdub recordings, and fall back to the preserved
 * canonical take when the stale mix was the chapter's active audio.
 */
function chapterAfterDuetRoutingChange(chapter) {
  const wasUsingDuetMix = chapter.audio_path && chapter.audio_path === chapter.duet_mix_path;
  const next = {
    ...resetChapterProofFields(chapter),
    duet_mix_path: undefined,
    n1_stem_path: undefined,
    n2_stem_path: undefined,
    acx_traffic_light: undefined,
  };
  if (wasUsingDuetMix) {
    next.audio_path = chapter.edited_audio_path || chapter.raw_audio_path || undefined;
  }
  return next;
}

/** Seat painting and source-track replacement share the same invalidation. */
function chapterAfterSeatChange(chapter) {
  return chapterAfterDuetRoutingChange(chapter);
}

/** True only when spoken text or per-character narrator routing changed. */
function scriptRoutingChanged(before, after) {
  return JSON.stringify(compactScriptRouting(before)) !== JSON.stringify(compactScriptRouting(after));
}

function compactScriptRouting(spans) {
  const compact = [];
  for (const span of Array.isArray(spans) ? spans : []) {
    const text = typeof span?.text === "string" ? span.text : "";
    const seat = typeof span?.seat === "string" ? span.seat : "";
    const previous = compact.at(-1);
    if (previous?.seat === seat) {
      previous.text += text;
    } else {
      compact.push({ seat, text });
    }
  }
  return compact;
}

/**
 * A duet mix is only useful when the script actually routes audio to both
 * seats. Without this guard, a chapter with every span still assigned to N1
 * could accept an N2 overdub, write a successful-looking mix, and silently
 * discard the overdub from the canonical output.
 */
function assertDuetMixRouting(segments, narrationSeat = "N1") {
  if (narrationSeat !== "N1" && narrationSeat !== "N2") {
    throw new Error("Narration seat must be N1 or N2");
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("Assign script spans to seats before mixing.");
  }
  let hasN2 = false;
  for (const segment of segments) {
    if (!segment || typeof segment !== "object") {
      throw new Error("Duet timeline contains an invalid segment.");
    }
    if (segment.seat !== "narration" && segment.seat !== "N1" && segment.seat !== "N2") {
      throw new Error("Duet timeline contains an invalid seat.");
    }
    const routedSeat = segment.seat === "narration" ? narrationSeat : segment.seat;
    if (routedSeat === "N2") {
      hasN2 = true;
    }
  }
  if (!hasN2) {
    throw new Error("Assign at least one script span to N2 before mixing.");
  }
}

function chapterHasAudio(chapter) {
  return [
    chapter.audio_path,
    chapter.raw_audio_path,
    chapter.edited_audio_path,
    chapter.bed_audio_path,
    chapter.overdub_audio_path,
    chapter.duet_mix_path,
    chapter.n1_stem_path,
    chapter.n2_stem_path,
  ].some((value) => typeof value === "string" && value.length > 0);
}

/** Solo projects persist only narration seats, regardless of renderer input. */
function seatForProjectMode(mode, seat) {
  if (mode === "solo") {
    return "narration";
  }
  return seat === "N1" || seat === "N2" ? seat : "narration";
}

/**
 * When leaving duet mode, a current duet mix must not remain the canonical
 * solo take. Prefer the preserved raw take when available; otherwise detach
 * the mix and let the user attach a solo recording.
 */
function chapterAfterSoloMode(chapter) {
  const wasUsingDuetMix = chapter.audio_path && chapter.audio_path === chapter.duet_mix_path;
  const reset = resetChapterDuetFields(resetChapterProofFields({
    ...chapter,
    acx_traffic_light: undefined,
  }));
  if (wasUsingDuetMix) {
    reset.audio_path = chapter.raw_audio_path || undefined;
  }
  return reset;
}

module.exports = {
  chapterAfterSoloMode,
  chapterAfterDuetRoutingChange,
  chapterAfterSeatChange,
  assertDuetMixRouting,
  chapterHasAudio,
  resetChapterAudioFields,
  resetChapterDuetFields,
  resetChapterProofFields,
  scriptRoutingChanged,
  seatForProjectMode,
};
