import { describe, expect, it } from "vitest";
import type { Pickup } from "../project/types";
import { advancePickupSession, buildPickupSession } from "./pickup-session";

function pickup(overrides: Partial<Pickup> & Pick<Pickup, "id" | "t_start" | "t_end">): Pickup {
  return {
    chapter_id: "ch01",
    expected: overrides.id,
    heard: "",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 1,
    ...overrides,
  };
}

describe("batch pickup session", () => {
  it("orders open pickups by the line the narrator will rerecord", () => {
    const session = buildPickupSession([
      pickup({ id: "later", t_start: 20, t_end: 21, line_start: 19, line_end: 23 }),
      pickup({ id: "ignored", t_start: 1, t_end: 2, status: "ignored" }),
      pickup({ id: "first", t_start: 5, t_end: 6, line_start: 4, line_end: 8 }),
    ]);

    expect(session.totalFlags).toBe(2);
    expect(session.items.map((item) => item.pickup.id)).toEqual(["first", "later"]);
  });

  it("groups several flags from the same sentence into one recording task", () => {
    const session = buildPickupSession([
      pickup({ id: "word-1", t_start: 5, t_end: 6, line_start: 4, line_end: 9 }),
      pickup({ id: "word-2", t_start: 7, t_end: 8, line_start: 4, line_end: 9 }),
    ]);

    expect(session.items).toHaveLength(1);
    expect(session.items[0].pickupIds).toEqual(["word-1", "word-2"]);
    expect(session.totalFlags).toBe(2);
  });

  it("shifts every later word and line timestamp by the applied duration delta", () => {
    const session = buildPickupSession([
      pickup({ id: "first", t_start: 5, t_end: 6, line_start: 4, line_end: 8 }),
      pickup({ id: "later", t_start: 20, t_end: 21, line_start: 19, line_end: 23 }),
    ]);

    const next = advancePickupSession(session, {
      pickupIds: ["first"],
      start: 4,
      end: 8,
      durationDelta: 1.25,
    });

    expect(next.completedTasks).toBe(1);
    expect(next.items[0].pickup).toMatchObject({
      t_start: 21.25,
      t_end: 22.25,
      line_start: 20.25,
      line_end: 24.25,
    });
  });

  it("removes overlapping queued tasks because the accepted full-line read superseded them", () => {
    const session = buildPickupSession([
      pickup({ id: "first", t_start: 5, t_end: 6, line_start: 4, line_end: 8 }),
      pickup({ id: "overlap", t_start: 7.5, t_end: 8.5, line_start: 7, line_end: 10 }),
      pickup({ id: "later", t_start: 15, t_end: 16, line_start: 14, line_end: 18 }),
    ]);

    const next = advancePickupSession(session, {
      pickupIds: ["first"],
      start: 4,
      end: 8,
      durationDelta: 0,
    });

    expect(next.items.map((item) => item.pickup.id)).toEqual(["later"]);
    expect(next.supersededFlags).toEqual(["overlap"]);
  });
});
