import { describe, expect, it } from "vitest";
import { shouldUseTranscriptOverride } from "./proof-transcript";

describe("proof transcript selection", () => {
  it("does not replace fresh audio timestamps with text generated for an earlier read", () => {
    expect(shouldUseTranscriptOverride({
      text: "Daphne crossed the room",
      origin: "generated",
      preferLive: true,
    })).toBe(false);
  });

  it("does not turn a displayed ASR result into an override on a later check", () => {
    expect(shouldUseTranscriptOverride({
      text: "Daphne crossed the room",
      origin: "generated",
      preferLive: false,
    })).toBe(false);
  });

  it("always timestamps a fresh booth recording from its own audio", () => {
    expect(shouldUseTranscriptOverride({
      text: "A manually corrected transcript",
      origin: "manual",
      preferLive: true,
    })).toBe(false);
  });

  it("keeps an explicit transcript edit as the manual proofing override", () => {
    expect(shouldUseTranscriptOverride({
      text: "A manually corrected transcript",
      origin: "manual",
      preferLive: false,
    })).toBe(true);
  });
});
