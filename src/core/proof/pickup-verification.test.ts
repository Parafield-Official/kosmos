import { describe, expect, it } from "vitest";
import {
  finalPickupProofReadiness,
  verifyPickupTranscript,
} from "./pickup-verification";

const words = (text: string, confidence = 0.96) => text.split(/\s+/u).map((word, index) => ({
  text: word,
  start: index * 0.3,
  end: index * 0.3 + 0.2,
  confidence,
}));

describe("pickup word verification", () => {
  it("confirms a pickup whose spoken words match the manuscript", () => {
    expect(verifyPickupTranscript({
      manuscript: "The moon hangs small, and yellow—and gibbous.",
      transcript: words("the moon hangs small and yellow and gibbous"),
    })).toMatchObject({
      status: "match",
      title: "Words match manuscript",
    });
  });

  it("accepts equivalent number and homophone forms", () => {
    expect(verifyPickupTranscript({
      manuscript: "Room two is right.",
      transcript: words("room 2 is write"),
    }).status).toBe("match");
  });

  it("flags changed, missing, or added words without returning a full raw transcript", () => {
    const result = verifyPickupTranscript({
      manuscript: "The moon hangs small and yellow and gibbous.",
      transcript: words("the moon hangs small yellow and gibious today"),
    });

    expect(result).toMatchObject({
      status: "mismatch",
      title: "Check the wording",
    });
    expect(result.expectedExcerpt).toBeTruthy();
    expect(result.heardExcerpt).toBeTruthy();
    expect(result.detail).toContain("Expected");
    expect(result.detail).toContain("heard");
    expect(result.detail).not.toContain("the moon hangs small yellow and gibious today");
  });

  it("does not accuse the narrator when no speech was recognized", () => {
    expect(verifyPickupTranscript({
      manuscript: "The moon hangs small and yellow and gibbous.",
      transcript: [],
    })).toMatchObject({
      status: "inconclusive",
      title: "Couldn’t verify the words",
    });
  });

  it("treats a low-confidence mismatch as inconclusive", () => {
    expect(verifyPickupTranscript({
      manuscript: "The moon hangs small and yellow and gibbous.",
      transcript: words("the moon hangs blue", 0.2),
    }).status).toBe("inconclusive");
  });

  it("does not require confidence metadata from a recognizer", () => {
    expect(verifyPickupTranscript({
      manuscript: "The moon hangs small.",
      transcript: words("the moon hangs small").map(({ confidence: _confidence, ...word }) => word),
    }).status).toBe("match");
  });
});

describe("final pickup proof readiness", () => {
  it("asks the narrator to verify edited joins before the full chapter pass", () => {
    expect(finalPickupProofReadiness([
      { editStatus: "applied", verificationStatus: "needs_verification" },
      { editStatus: "applied", verificationStatus: "verified" },
    ])).toEqual({
      ready: false,
      label: "Verify 1 edited join first",
    });
  });

  it("offers one final chapter pass after all active joins are verified", () => {
    expect(finalPickupProofReadiness([
      { editStatus: "applied", verificationStatus: "verified" },
      { editStatus: "reverted", verificationStatus: "needs_verification" },
    ])).toEqual({
      ready: true,
      label: "Run final chapter check",
    });
  });

  it("does not offer a final pickup pass when no pickup is applied", () => {
    expect(finalPickupProofReadiness([])).toEqual({ ready: false, label: "No applied pickups" });
  });
});
