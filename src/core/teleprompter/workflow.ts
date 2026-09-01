import type { LiveVoiceStatus } from "./live";

export type TeleprompterWorkflowStage = "ready" | "recording" | "paused" | "saving" | "stopped-unsaved" | "stopped";

export interface TeleprompterWorkflow {
  stage: TeleprompterWorkflowStage;
  activeStep: 1 | 2 | 3;
  title: string;
  detail: string;
  primaryLabel: "Start recording" | "Stop recording" | "Resume recording" | "Save this recording" | "Continue recording" | null;
  showFirstReadGuide: boolean;
  canReview: boolean;
  canStartOver: boolean;
}

export function teleprompterWorkflow(input: {
  hasSavedTape: boolean;
  hasPendingDraft: boolean;
  recording: boolean;
  paused: boolean;
  status: LiveVoiceStatus;
}): TeleprompterWorkflow {
  if (input.status === "processing") {
    return {
      stage: "saving",
      activeStep: 3,
      title: "Saving your booth read",
      detail: "Keep this page open. Your recording and manuscript position are being saved.",
      primaryLabel: null,
      showFirstReadGuide: false,
      canReview: false,
      canStartOver: false,
    };
  }
  if (input.recording && input.paused) {
    return {
      stage: "paused",
      activeStep: 2,
      title: "Recording paused",
      detail: "Your place is held and the microphone is not being added to the booth read.",
      primaryLabel: "Resume recording",
      showFirstReadGuide: false,
      canReview: false,
      canStartOver: false,
    };
  }
  if (input.recording) {
    return {
      stage: "recording",
      activeStep: 2,
      title: "Recording your booth read",
      detail: "Read naturally. Kosmos follows the highlighted line; Stop lets you listen and name the read before saving.",
      primaryLabel: "Stop recording",
      showFirstReadGuide: false,
      canReview: false,
      canStartOver: false,
    };
  }
  if (input.hasPendingDraft) {
    return {
      stage: "stopped-unsaved",
      activeStep: 3,
      title: "Recording stopped",
      detail: "Listen to this draft, give it a name, then save it before continuing or opening Review.",
      primaryLabel: "Save this recording",
      showFirstReadGuide: false,
      canReview: false,
      canStartOver: false,
    };
  }
  if (input.hasSavedTape) {
    return {
      stage: "stopped",
      activeStep: 3,
      title: "Booth read saved",
      detail: "Listen, continue from your saved place, or choose the recording to review against the manuscript.",
      primaryLabel: "Continue recording",
      showFirstReadGuide: false,
      canReview: true,
      canStartOver: true,
    };
  }
  return {
    stage: "ready",
    activeStep: 1,
    title: "Ready to record",
    detail: "Press Start recording, then read naturally. Stop lets you listen and name the read before you save it.",
    primaryLabel: "Start recording",
    showFirstReadGuide: true,
    canReview: false,
    canStartOver: false,
  };
}

export function shouldOfferChapterReview(input: {
  recordedCoverage: number;
  pageProgress: number;
}): boolean {
  return input.recordedCoverage >= 0.9 || input.pageProgress >= 0.9;
}

export function initialTeleprompterPanels(chapterCount: number): {
  chaptersOpen: boolean;
  materialsOpen: boolean;
} {
  return {
    chaptersOpen: chapterCount > 1,
    materialsOpen: false,
  };
}
