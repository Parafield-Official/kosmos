import { describe, expect, it } from "vitest";
import { pickupKindPresentation } from "./pickup-display";

describe("pickupKindPresentation", () => {
  it("uses red error treatment only for a misread substitution", () => {
    expect(pickupKindPresentation("sub")).toEqual({
      label: "misread",
      tone: "danger",
    });
  });

  it("uses yellow warning treatment for missing and added words", () => {
    expect(pickupKindPresentation("skip")).toEqual({
      label: "missing",
      tone: "warning",
    });
    expect(pickupKindPresentation("insert")).toEqual({
      label: "added",
      tone: "warning",
    });
  });

  it("keeps a long pause visually separate from word mistakes", () => {
    expect(pickupKindPresentation("pause")).toEqual({
      label: "long pause",
      tone: "info",
    });
  });
});
