import { describe, expect, it } from "vitest";
import { tokenIndexAtTime } from "./review-timing";

const aligned = [
  { tokenIndex: 0, start: 0, end: 0.4 },
  { tokenIndex: 1, start: 0.4, end: 0.8 },
  { tokenIndex: 2, start: 0.8, end: 1.2 },
];

describe("tokenIndexAtTime", () => {
  it("returns the word that covers that instant", () => {
    expect(tokenIndexAtTime(aligned, 0.5)).toBe(1);
  });

  it("holds the last spoken word after the tape ends", () => {
    expect(tokenIndexAtTime(aligned, 2)).toBe(2);
  });

  it("uses the first timed word at the start", () => {
    expect(tokenIndexAtTime(aligned, 0)).toBe(0);
  });
});
