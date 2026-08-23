import { describe, expect, it } from "vitest";
import { buildPickupComparisons } from "./comparison";

describe("pickup A/B comparisons", () => {
  it("pairs a pickup recording with the unchanged source range", () => {
    expect(buildPickupComparisons({
      rawAudioPath: "audio/01_raw.wav",
      currentAudioPath: "audio/01_edited.wav",
      punches: [{
        id: "punch-1",
        chapter_id: "ch01",
        pickup_id: "pickup-7",
        path: "audio/pickups/ch01-pickup-7.wav",
        edited_path: "audio/01_edited.wav",
        verification_status: "needs_verification",
        t_start: 8.25,
        t_end: 10.5,
        created_at: "2026-08-18T12:00:00.000Z",
      }],
    })).toEqual([expect.objectContaining({
      pickupId: "pickup-7",
      originalPath: "audio/01_raw.wav",
      replacementPath: "audio/pickups/ch01-pickup-7.wav",
      editedPath: "audio/01_edited.wav",
      start: 8.25,
      end: 10.5,
      verificationStatus: "needs_verification",
    })]);
  });

  it("ignores incomplete punch records and sorts newest first", () => {
    const result = buildPickupComparisons({
      rawAudioPath: "audio/raw.wav",
      currentAudioPath: "audio/current.wav",
      punches: [
        { id: "bad", chapter_id: "ch", path: "audio/bad.wav", created_at: "2026-08-18T10:00:00Z" },
        { id: "old", chapter_id: "ch", pickup_id: "p-old", path: "audio/old.wav", t_start: 1, t_end: 2, created_at: "2026-08-18T10:00:00Z" },
        { id: "new", chapter_id: "ch", pickup_id: "p-new", path: "audio/new.wav", t_start: 3, t_end: 4, created_at: "2026-08-18T11:00:00Z" },
      ],
    });
    expect(result.map((item) => item.pickupId)).toEqual(["p-new", "p-old"]);
  });
});
