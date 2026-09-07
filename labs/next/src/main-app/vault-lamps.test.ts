import { describe, expect, it } from "vitest";
import { LAMP_ALL, normalizeLampSelection } from "./vault-lamps";

describe("gallery light selection", () => {
  it("keeps All and a single lamp as exclusive presets", () => {
    expect(normalizeLampSelection(LAMP_ALL)).toBe(LAMP_ALL);
    expect(normalizeLampSelection(1 << 3)).toBe(1 << 3);
  });

  it("migrates old multi-lamp and off states to one valid preset", () => {
    expect(normalizeLampSelection(0b10100)).toBe(0b00100);
    expect(normalizeLampSelection(0)).toBe(LAMP_ALL);
  });
});
