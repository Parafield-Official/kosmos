const { normalizePunchBounds } = require("./punch.cjs");

describe("punch boundary validation", () => {
  it("clamps tiny decoder-duration overshoot without creating an append", () => {
    expect(normalizePunchBounds(1, 2.005, 2)).toEqual({ start: 1, end: 2 });
  });

  it("rejects a range that starts at or beyond the take end", () => {
    expect(() => normalizePunchBounds(2.001, 2.005, 2)).toThrow(/inside/i);
    expect(() => normalizePunchBounds(1.5, 1.4, 2)).toThrow(/inside/i);
  });
});
