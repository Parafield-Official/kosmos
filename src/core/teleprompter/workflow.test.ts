import { describe, expect, it } from "vitest";
import {
  initialTeleprompterPanels,
  shouldOfferChapterReview,
  teleprompterWorkflow,
} from "./workflow";

describe("first-use teleprompter workflow", () => {
  it("explains the first recording before asking the narrator to act", () => {
    expect(teleprompterWorkflow({
      hasSavedTape: false,
      hasPendingDraft: false,
      recording: false,
      paused: false,
      status: "off",
    })).toMatchObject({
      stage: "ready",
      activeStep: 1,
      title: "Ready to record",
      primaryLabel: "Start recording",
      showFirstReadGuide: true,
      canReview: false,
      canStartOver: false,
    });
  });

  it("makes the active recording state and stop consequence obvious", () => {
    expect(teleprompterWorkflow({
      hasSavedTape: false,
      hasPendingDraft: false,
      recording: true,
      paused: false,
      status: "listening",
    })).toMatchObject({
      stage: "recording",
      activeStep: 2,
      title: "Recording your booth read",
      primaryLabel: "Stop recording",
      showFirstReadGuide: false,
    });
  });

  it("distinguishes a break from a stopped recording", () => {
    expect(teleprompterWorkflow({
      hasSavedTape: false,
      hasPendingDraft: false,
      recording: true,
      paused: true,
      status: "paused",
    })).toMatchObject({
      stage: "paused",
      activeStep: 2,
      title: "Recording paused",
      primaryLabel: "Resume recording",
    });
  });

  it("shows that the recording is being made safe while processing", () => {
    expect(teleprompterWorkflow({
      hasSavedTape: false,
      hasPendingDraft: false,
      recording: false,
      paused: false,
      status: "processing",
    })).toMatchObject({
      stage: "saving",
      activeStep: 3,
      title: "Saving your booth read",
      primaryLabel: null,
    });
  });

  it("requires an explicit named save after stopping", () => {
    expect(teleprompterWorkflow({
      hasSavedTape: false,
      hasPendingDraft: true,
      recording: false,
      paused: false,
      status: "off",
    })).toMatchObject({
      stage: "stopped-unsaved",
      title: "Recording stopped",
      primaryLabel: "Save this recording",
      canReview: false,
      canStartOver: false,
    });
  });

  it("presents one clear decision after a booth read is saved", () => {
    expect(teleprompterWorkflow({
      hasSavedTape: true,
      hasPendingDraft: false,
      recording: false,
      paused: false,
      status: "off",
    })).toMatchObject({
      stage: "stopped",
      activeStep: 3,
      title: "Booth read saved",
      primaryLabel: "Continue recording",
      showFirstReadGuide: false,
      canReview: true,
      canStartOver: true,
    });
  });

  it("only offers chapter completion near the end of the read", () => {
    expect(shouldOfferChapterReview({ recordedCoverage: 0.1, pageProgress: 0 })).toBe(false);
    expect(shouldOfferChapterReview({ recordedCoverage: 0.4, pageProgress: 0.95 })).toBe(true);
    expect(shouldOfferChapterReview({ recordedCoverage: 0.92, pageProgress: 0.2 })).toBe(true);
  });

  it("opens with a clean reading surface and only keeps a useful chapter rail", () => {
    expect(initialTeleprompterPanels(1)).toEqual({ chaptersOpen: false, materialsOpen: false });
    expect(initialTeleprompterPanels(4)).toEqual({ chaptersOpen: true, materialsOpen: false });
  });
});
