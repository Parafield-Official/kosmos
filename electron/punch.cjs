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

module.exports = { normalizePunchBounds };
