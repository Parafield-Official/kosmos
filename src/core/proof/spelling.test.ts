import { describe, expect, it } from "vitest";
import { americanSpelling } from "./spelling";

/** Both sides of a pickup are folded, so agreement is what matters. */
function agrees(page: string, heard: string): boolean {
  return americanSpelling(page) === americanSpelling(heard);
}

describe("americanSpelling", () => {
  it("folds the -our family, with inflections", () => {
    expect(agrees("harbour", "harbor")).toBe(true);
    expect(agrees("colours", "colors")).toBe(true);
    expect(agrees("favourite", "favorite")).toBe(true);
    expect(agrees("labouring", "laboring")).toBe(true);
    expect(agrees("neighbourless", "neighborless")).toBe(true);
  });

  it("folds -ise and -yse verbs", () => {
    expect(agrees("realise", "realize")).toBe(true);
    expect(agrees("realised", "realized")).toBe(true);
    expect(agrees("organisation", "organization")).toBe(true);
    expect(agrees("analyse", "analyze")).toBe(true);
    expect(agrees("paralysing", "paralyzing")).toBe(true);
  });

  it("folds -re endings", () => {
    expect(agrees("centre", "center")).toBe(true);
    expect(agrees("theatres", "theaters")).toBe(true);
    expect(agrees("litre", "liter")).toBe(true);
    expect(agrees("sombre", "somber")).toBe(true);
  });

  it("folds a doubled l before an ending", () => {
    expect(agrees("travelled", "traveled")).toBe(true);
    expect(agrees("signalling", "signaling")).toBe(true);
    expect(agrees("jeweller", "jeweler")).toBe(true);
    expect(agrees("marvellous", "marvelous")).toBe(true);
  });

  it("folds the words British English spells with one l and American with two", () => {
    expect(agrees("fulfilment", "fulfillment")).toBe(true);
    expect(agrees("instalments", "installments")).toBe(true);
    expect(agrees("skilful", "skillful")).toBe(true);
    expect(agrees("wilful", "willful")).toBe(true);
    expect(agrees("enrol", "enroll")).toBe(true);
  });

  it("folds -ogue words", () => {
    expect(agrees("catalogue", "catalog")).toBe(true);
    expect(agrees("dialogues", "dialogs")).toBe(true);
  });

  it("folds the pairs no rule can derive", () => {
    expect(agrees("grey", "gray")).toBe(true);
    expect(agrees("moustache", "mustache")).toBe(true);
    expect(agrees("pyjamas", "pajamas")).toBe(true);
    expect(agrees("ploughed", "plowed")).toBe(true);
    expect(agrees("storeys", "stories")).toBe(true);
    expect(agrees("defence", "defense")).toBe(true);
  });

  it("never folds two different words onto each other", () => {
    // A real misread has to survive this, so these must stay apart.
    const distinct: ReadonlyArray<readonly [string, string]> = [
      ["four", "for"],
      ["hour", "or"],
      ["your", "yor"],
      ["pour", "por"],
      ["sour", "sor"],
      ["tour", "tor"],
      ["dour", "door"],
      ["filled", "filed"],
      ["called", "caled"],
      ["spilled", "spiled"],
      ["callous", "calous"],
      ["jealous", "jealouse"],
      ["prise", "prize"],
      ["rise", "rize"],
      ["wise", "wize"],
      ["more", "moer"],
      ["care", "caer"],
      ["sure", "suer"],
      ["figure", "figuer"],
      ["acre", "acer"],
      ["ogre", "oger"],
      ["vogue", "vog"],
      ["rogue", "rog"],
    ];
    for (const [left, right] of distinct) {
      expect(agrees(left, right), `${left} must not fold onto ${right}`).toBe(false);
    }
  });

  it("leaves ordinary words alone", () => {
    for (const word of ["the", "lamp", "table", "burned", "rain", "paper", "letter", "aloud"]) {
      expect(americanSpelling(word)).toBe(word);
    }
  });

  it("ignores case", () => {
    expect(americanSpelling("Harbour")).toBe("harbor");
    expect(americanSpelling("REALISE")).toBe("realize");
  });

  it("is stable when applied twice", () => {
    for (const word of ["harbour", "realise", "centre", "travelled", "catalogue", "grey", "four"]) {
      const once = americanSpelling(word);
      expect(americanSpelling(once)).toBe(once);
    }
  });
});
