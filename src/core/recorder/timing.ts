/**
 * Return elapsed active recording time in seconds.
 *
 * `pausedDurationMs` contains pauses that have already ended. When a recorder
 * is currently paused, `activePauseStartedMs` lets the clock stop immediately
 * instead of waiting for the next resume event.
 */
export function recordingElapsedSeconds(
  nowMs: number,
  startedAtMs: number,
  pausedDurationMs = 0,
  activePauseStartedMs?: number,
): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(startedAtMs)) {
    return 0;
  }
  const completedPauses = Number.isFinite(pausedDurationMs) ? Math.max(0, pausedDurationMs) : 0;
  const activePause = activePauseStartedMs !== undefined
    && Number.isFinite(activePauseStartedMs)
    ? Math.max(0, nowMs - activePauseStartedMs)
    : 0;
  return Math.max(0, nowMs - startedAtMs - completedPauses - activePause) / 1000;
}
