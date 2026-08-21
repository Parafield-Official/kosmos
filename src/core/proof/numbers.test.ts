import { describe, expect, it } from "vitest";
import { canonicalDigits, foldNumberRun } from "./numbers";
import { homophoneClass } from "./homophones";
import { manuscriptMatchUnits, transcriptMatchUnits, tokenizeManuscript } from "./normalize";

function fold(spoken: string): { key: string; length: number } | null {
  return foldNumberRun(spoken.split(" "), 0);
}

function manuscriptKeys(text: string): string[] {
  return manuscriptMatchUnits(tokenizeManuscript(text)).map((unit) => unit.key);
}

function transcriptKeys(spoken: string): string[] {
  return transcriptMatchUnits(spoken.split(" ").map((text) => ({ text }))).map((unit) => unit.key);
}

describe("number folding", () => {
  it("reads a year as two spoken halves", () => {
    expect(fold("nineteen ninety nine")).toEqual({ key: "1999", length: 3 });
    expect(fold("twenty twenty five")).toEqual({ key: "2025", length: 3 });
    expect(fold("nineteen oh five")).toEqual({ key: "1905", length: 3 });
  });

  it("reads the same year spoken the long way", () => {
    expect(fold("one thousand nine hundred ninety nine")).toEqual({ key: "1999", length: 6 });
    expect(fold("two million five hundred thousand")).toEqual({ key: "2500000", length: 5 });
    expect(fold("one hundred and one")).toEqual({ key: "101", length: 4 });
  });

  it("combines tens with units", () => {
    expect(fold("twenty one")).toEqual({ key: "21", length: 2 });
    expect(fold("ninety nine")).toEqual({ key: "99", length: 2 });
  });

  it("keeps separate numbers apart when they are not year-shaped", () => {
    // "One. Three." arrives with no punctuation; joining it into 13 would
    // invent a mismatch against a manuscript that reads them apart.
    expect(fold("one three")).toEqual({ key: "1", length: 1 });
    expect(fold("five five five")).toEqual({ key: "5", length: 1 });
  });

  it("marks ordinals so they cannot match the plain figure", () => {
    expect(fold("third")?.key).toBe("3#ord");
    expect(fold("twenty first")?.key).toBe("21#ord");
    expect(canonicalDigits("3rd")).toBe("3#ord");
    expect(canonicalDigits("21st")).toBe("21#ord");
    expect(canonicalDigits("3")).toBe("3");
  });

  it("leaves words that are not numbers alone", () => {
    expect(fold("harbour")).toBeNull();
    expect(canonicalDigits("harbour")).toBeNull();
    expect(canonicalDigits("3a")).toBeNull();
  });

  it("folds the manuscript and the transcript onto the same keys", () => {
    expect(manuscriptKeys("It closed in 1999.")).toEqual(transcriptKeys("It closed in nineteen ninety nine"));
    expect(manuscriptKeys("twenty-one boats")).toEqual(transcriptKeys("twenty one boats"));
    expect(manuscriptKeys("He counted 21 crates.")).toEqual(transcriptKeys("He counted twenty one crates"));
    expect(manuscriptKeys("One. Three.")).toEqual(transcriptKeys("One Three"));
  });

  it("still separates figures that really differ", () => {
    expect(manuscriptKeys("in 1999")).not.toEqual(transcriptKeys("in nineteen eighty nine"));
    expect(manuscriptKeys("the 3rd day")).not.toEqual(transcriptKeys("the three day"));
  });

  it("splits a hyphenated compound into the words a reader says", () => {
    expect(manuscriptKeys("a half-empty pier")).toEqual(["a", "half", "empty", "pier"]);
  });
});

describe("homophone classes", () => {
  it("gives same-sounding words a shared key", () => {
    expect(homophoneClass("their")).toBe(homophoneClass("there"));
    expect(homophoneClass("theyre")).toBe(homophoneClass("their"));
    expect(homophoneClass("its")).toBe(homophoneClass("it's"));
    expect(homophoneClass("to")).toBe(homophoneClass("two"));
  });

  it("leaves heteronyms out, because choosing the wrong sound is a real error", () => {
    for (const word of ["read", "red", "lead", "led", "sow", "sew", "tear", "tier", "bow", "bough", "row", "roe"]) {
      expect(homophoneClass(word)).toBeNull();
    }
  });

  it("does not merge words that merely look similar", () => {
    expect(homophoneClass("harbour")).toBeNull();
    expect(homophoneClass("quiet")).toBeNull();
  });
});
