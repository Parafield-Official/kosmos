import { describe, expect, it } from "vitest";
import { flagKindLabel, flagWrongCopy } from "./flag-kind";

describe("flagKindLabel", () => {
  it("uses extra and lacked instead of added and missing", () => {
    expect(flagKindLabel("sub")).toBe("misread");
    expect(flagKindLabel("insert")).toBe("extra");
    expect(flagKindLabel("skip")).toBe("lacked");
    expect(flagKindLabel("pause")).toBe("long pause");
  });
});

describe("flagWrongCopy", () => {
  it("names the mismatch the narrator actually made", () => {
    expect(flagWrongCopy({ kind: "sub", expected: "copper", heard: "copter" })).toBe(
      "Misread: heard “copter” instead of “copper”.",
    );
    expect(flagWrongCopy({ kind: "insert", heard: "um" })).toBe('Extra on the tape: “um”.');
    expect(flagWrongCopy({ kind: "skip", expected: "pennants" })).toBe('Lacked on the tape: “pennants”.');
  });
});
