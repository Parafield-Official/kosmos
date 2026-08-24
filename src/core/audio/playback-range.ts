export interface PlaybackRange {
  start: number;
  end: number;
}

/** The exact manuscript-word interval. No audible context belongs here. */
export function selectedPlaybackRange(start: number, end: number): PlaybackRange {
  const safeStart = finiteSeconds(start);
  const safeEnd = Math.max(safeStart, finiteSeconds(end));
  return { start: safeStart, end: safeEnd };
}

/** A deliberately wider interval for search results and contextual listening. */
export function contextPlaybackRange(
  start: number,
  end: number,
  paddingSeconds = 0.5,
): PlaybackRange {
  const selection = selectedPlaybackRange(start, end);
  const padding = finiteSeconds(paddingSeconds);
  return {
    start: roundedSeconds(Math.max(0, selection.start - padding)),
    end: roundedSeconds(selection.end + padding),
  };
}

/** Context before a pickup, ending exactly where the selected words begin. */
export function leadInPlaybackRange(start: number, leadInSeconds: number): PlaybackRange {
  const selectionStart = finiteSeconds(start);
  const leadIn = finiteSeconds(leadInSeconds);
  return {
    start: roundedSeconds(Math.max(0, selectionStart - leadIn)),
    end: selectionStart,
  };
}

/** Account for timer granularity without allowing an audible neighboring word. */
export function playbackReachedEnd(currentTime: number, end: number, toleranceSeconds = 0.005): boolean {
  if (!Number.isFinite(currentTime) || !Number.isFinite(end)) {
    return false;
  }
  return currentTime >= end - Math.max(0, toleranceSeconds);
}

function finiteSeconds(value: number): number {
  return roundedSeconds(Number.isFinite(value) ? Math.max(0, value) : 0);
}

function roundedSeconds(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
