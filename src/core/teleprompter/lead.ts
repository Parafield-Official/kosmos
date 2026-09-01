/**
 * Predictive cursor lead for voice follow.
 *
 * The follow model cannot report a word until it has heard it, so a cursor
 * driven only by confirmed matches always trails the narrator by the model's
 * emission delay. Between confirmations, coast forward at a fraction of the
 * narrator's measured pace so the highlight sits where they are reading rather
 * than where they were. Running under the measured rate means the projection
 * under-runs, so the next confirmation is almost always a small forward
 * correction instead of a visible snap backwards.
 */

/** Fraction of the measured pace to coast at. Under 1 so the lead under-runs. */
export const LEAD_PACE_FACTOR = 0.85;
/**
 * Never project further than this ahead of the last confirmed word. One word
 * is the most that can be justified: the projection only exists to cover audio
 * already captured but not yet transcribed, and it must never invite the
 * narrator to read ahead of themselves.
 */
export const LEAD_CAP_WORDS = 1;
/**
 * Silence this long means the narrator has stopped rather than paused between
 * words, so stop projecting — there is no unheard speech left to cover.
 */
export const LEAD_SILENCE_HOLD_MS = 320;
/**
 * Silence this long means the model has also finished flushing what it heard,
 * so the confirmed cursor is now the truth and the highlight settles onto it.
 */
export const LEAD_SETTLE_MS = 800;
/** Words per second the estimator will accept (90–360 wpm). */
export const LEAD_MIN_WPS = 1.5;
export const LEAD_MAX_WPS = 6;
/** Starting pace before the narrator has been measured (150 wpm). */
export const LEAD_DEFAULT_WPS = 2.5;
/** Weight of each new pace observation. */
export const LEAD_PACE_SMOOTHING = 0.3;
/**
 * A confirmation this far behind the highlight is treated as a real
 * disagreement rather than matcher jitter.
 */
export const LEAD_BACKWARD_TOLERANCE = 2;
/** How long that disagreement must persist before the highlight moves back. */
export const LEAD_BACKWARD_HOLD_MS = 200;

export type LeadState = {
  /** Last cursor the matcher confirmed. */
  anchor: number;
  /** Clock reading when `anchor` was confirmed, in milliseconds. */
  anchorAt: number;
  /** Smoothed narrator pace in words per second. */
  wordsPerSecond: number;
  /** Highest cursor shown so far, so the highlight never drifts backwards. */
  shown: number;
  /** Clock reading when an unresolved backward disagreement began. */
  backwardSince: number | null;
};

export function createLeadState(cursor: number, now: number): LeadState {
  const safe = Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0;
  return {
    anchor: safe,
    anchorAt: now,
    wordsPerSecond: LEAD_DEFAULT_WPS,
    shown: safe,
    backwardSince: null,
  };
}

/** Record a cursor the matcher just confirmed and re-estimate the pace. */
export function leadOnConfirm(state: LeadState, cursor: number, now: number): LeadState {
  if (!Number.isFinite(cursor)) {
    return state;
  }
  const next = Math.max(0, Math.floor(cursor));
  const elapsedSeconds = (now - state.anchorAt) / 1000;
  const advanced = next - state.anchor;
  let wordsPerSecond = state.wordsPerSecond;
  if (advanced > 0 && elapsedSeconds > 0.05) {
    const observed = advanced / elapsedSeconds;
    if (observed >= LEAD_MIN_WPS && observed <= LEAD_MAX_WPS) {
      wordsPerSecond += (observed - wordsPerSecond) * LEAD_PACE_SMOOTHING;
    }
  }

  if (next < state.shown - LEAD_BACKWARD_TOLERANCE) {
    // The narrator may have jumped back, or the matcher may have slipped for a
    // moment. Track the anchor either way, but hold the highlight still until
    // the disagreement proves itself — a prompter that twitches backwards is
    // more disruptive to a read than one that sits slightly ahead.
    const since = state.backwardSince ?? now;
    if (now - since < LEAD_BACKWARD_HOLD_MS) {
      return { ...state, anchor: next, anchorAt: now, wordsPerSecond, backwardSince: since };
    }
    return { anchor: next, anchorAt: now, wordsPerSecond, shown: next, backwardSince: null };
  }

  return {
    anchor: next,
    anchorAt: now,
    wordsPerSecond,
    shown: Math.max(state.shown, next),
    backwardSince: null,
  };
}

/**
 * Cursor to display now.
 *
 * While speech is arriving, coast past the last confirmation at the measured
 * pace so the highlight covers audio the model has not finished transcribing.
 * The moment speech stops there is nothing left to cover, so hold still; once
 * the model has had time to flush, settle back onto the confirmed word. That
 * last step is what keeps the highlight off words the narrator never read.
 *
 * `lastSpeechAt` is the clock reading when speech was last heard. Pass null
 * when there is no signal to judge by, which keeps the projection running.
 */
export function leadAdvance(
  state: LeadState,
  now: number,
  limit: number,
  enabled = true,
  lastSpeechAt: number | null = null,
): { state: LeadState; cursor: number } {
  const ceiling = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const settle = () => {
    const cursor = Math.min(ceiling, state.anchor);
    return { state: { ...state, shown: cursor }, cursor };
  };
  if (!enabled) {
    return settle();
  }

  const silentFor = lastSpeechAt === null ? 0 : Math.max(0, now - lastSpeechAt);
  if (silentFor >= LEAD_SETTLE_MS) {
    return settle();
  }
  if (silentFor >= LEAD_SILENCE_HOLD_MS) {
    // Between "stopped talking" and "model has caught up": hold the highlight
    // where it is rather than jumping it backwards and then forwards again.
    const cursor = Math.min(ceiling, Math.max(state.shown, state.anchor));
    return { state: { ...state, shown: cursor }, cursor };
  }

  const elapsedSeconds = Math.max(0, (now - state.anchorAt) / 1000);
  const projected = state.anchor + Math.min(
    LEAD_CAP_WORDS,
    elapsedSeconds * state.wordsPerSecond * LEAD_PACE_FACTOR,
  );
  const cursor = Math.min(ceiling, Math.floor(Math.max(state.shown, projected)));
  return { state: { ...state, shown: Math.max(state.shown, cursor) }, cursor };
}
