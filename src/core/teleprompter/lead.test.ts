import { describe, expect, it } from "vitest";
import {
  createLeadState,
  leadAdvance,
  leadOnConfirm,
  LEAD_BACKWARD_HOLD_MS,
  LEAD_CAP_WORDS,
  LEAD_DEFAULT_WPS,
  LEAD_SETTLE_MS,
  LEAD_SILENCE_HOLD_MS,
} from "./lead";

describe("predictive cursor lead", () => {
  it("holds still at the anchor before any time passes", () => {
    const state = createLeadState(10, 1_000);
    expect(leadAdvance(state, 1_000, 100).cursor).toBe(10);
  });

  it("coasts forward between confirmations but never past the cap", () => {
    const state = createLeadState(10, 1_000);
    // 400 ms at the default 2.5 w/s and 0.85 pace factor is ~0.85 words.
    expect(leadAdvance(state, 1_400, 100).cursor).toBe(10);
    // A full second is ~2.1 words of projection, which the cap trims down.
    expect(leadAdvance(state, 2_000, 100).cursor).toBe(10 + LEAD_CAP_WORDS);
    // Ten seconds must not run away.
    expect(leadAdvance(state, 11_000, 100).cursor).toBe(10 + LEAD_CAP_WORDS);
  });

  it("never reports past the manuscript length", () => {
    const state = createLeadState(99, 1_000);
    expect(leadAdvance(state, 5_000, 100).cursor).toBe(100);
  });

  it("reports the raw anchor when the lead is disabled", () => {
    const state = createLeadState(10, 1_000);
    expect(leadAdvance(state, 5_000, 100, false).cursor).toBe(10);
  });

  it("learns a faster narrator and projects further in the same time", () => {
    let slow = createLeadState(0, 0);
    let fast = createLeadState(0, 0);
    // Slow: 2 words per second. Fast: 5 words per second.
    for (let step = 1; step <= 6; step += 1) {
      slow = leadOnConfirm(slow, step * 2, step * 1_000);
      fast = leadOnConfirm(fast, step * 5, step * 1_000);
    }
    expect(fast.wordsPerSecond).toBeGreaterThan(slow.wordsPerSecond);
    expect(slow.wordsPerSecond).toBeGreaterThan(LEAD_DEFAULT_WPS * 0.5);
  });

  it("ignores implausible pace observations", () => {
    const state = createLeadState(0, 0);
    // 400 words in one second is a resync jump, not a speaking rate.
    const jumped = leadOnConfirm(state, 400, 1_000);
    expect(jumped.wordsPerSecond).toBe(state.wordsPerSecond);
  });

  it("does not move the highlight backwards on a brief disagreement", () => {
    let state = createLeadState(20, 0);
    state = leadAdvance(state, 1_000, 100).state;
    const shownBefore = state.shown;
    // Matcher slips back 5 words; the highlight must hold.
    state = leadOnConfirm(state, 15, 1_100);
    expect(leadAdvance(state, 1_100, 100).cursor).toBe(shownBefore);
  });

  it("accepts a backward correction once it persists", () => {
    let state = createLeadState(20, 0);
    state = leadAdvance(state, 1_000, 100).state;
    state = leadOnConfirm(state, 15, 1_100);
    state = leadOnConfirm(state, 15, 1_100 + LEAD_BACKWARD_HOLD_MS + 1);
    expect(leadAdvance(state, 1_100 + LEAD_BACKWARD_HOLD_MS + 1, 100).cursor).toBe(15);
  });

  it("stops projecting once the narrator falls silent", () => {
    const state = createLeadState(10, 1_000);
    const speechAt = 1_000;
    // Still reading: the projection runs.
    expect(leadAdvance(state, 1_200, 100, true, 1_150).cursor).toBeGreaterThanOrEqual(10);
    // Silent past the hold: no further advance beyond what was already shown.
    const held = leadAdvance(state, speechAt + LEAD_SILENCE_HOLD_MS + 10, 100, true, speechAt);
    expect(held.cursor).toBe(10);
  });

  it("settles back onto the confirmed word after a real stop", () => {
    let state = createLeadState(10, 0);
    // Coast a word ahead while speech is flowing.
    state = leadAdvance(state, 600, 100, true, 590).state;
    expect(state.shown).toBe(10 + LEAD_CAP_WORDS);
    // The narrator stops. Once the model has had time to flush, the highlight
    // must return to the last word actually read rather than sitting ahead.
    const settled = leadAdvance(state, 600 + LEAD_SETTLE_MS + 10, 100, true, 590);
    expect(settled.cursor).toBe(10);
    expect(settled.state.shown).toBe(10);
  });

  it("never sits more than one word ahead of the confirmed position", () => {
    const state = createLeadState(40, 0);
    for (let t = 0; t <= 4_000; t += 50) {
      const cursor = leadAdvance(state, t, 100, true, t).cursor;
      expect(cursor - state.anchor).toBeLessThanOrEqual(LEAD_CAP_WORDS);
    }
  });

  it("keeps coasting through the short gaps between words", () => {
    const state = createLeadState(10, 0);
    // A 120 ms inter-word gap is not a stop; the projection should survive it.
    expect(leadAdvance(state, 500, 100, true, 380).cursor).toBe(10 + LEAD_CAP_WORDS);
  });

  it("treats a one-word disagreement as jitter, not a jump back", () => {
    let state = createLeadState(20, 0);
    state = leadAdvance(state, 500, 100).state;
    const shown = state.shown;
    for (let step = 0; step < 5; step += 1) {
      state = leadOnConfirm(state, 19, 600 + step * 200);
    }
    expect(leadAdvance(state, 2_000, 100).cursor).toBeGreaterThanOrEqual(shown);
  });
});
