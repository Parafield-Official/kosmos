import type { PickupKind } from "../../../../src/core/project/types";

/**
 * Proof flag names on the Labs page. Matches the product copy:
 * misread, extra, lacked — not the engine's skip/insert labels.
 */
export function flagKindLabel(kind: PickupKind): string {
  if (kind === "insert") {
    return "extra";
  }
  if (kind === "skip") {
    return "lacked";
  }
  if (kind === "pause") {
    return "long pause";
  }
  return "misread";
}

export function flagWrongCopy(input: {
  kind: PickupKind;
  expected?: string;
  heard?: string;
}): string {
  const expected = (input.expected ?? "").trim();
  const heard = (input.heard ?? "").trim();
  if (input.kind === "insert") {
    return heard ? `Extra on the tape: “${heard}”.` : "Extra sound that is not on the page.";
  }
  if (input.kind === "skip") {
    return expected ? `Lacked on the tape: “${expected}”.` : "A word on the page was not heard.";
  }
  if (input.kind === "pause") {
    return "A long pause in the middle of the sentence.";
  }
  if (heard && expected && heard !== expected) {
    return `Misread: heard “${heard}” instead of “${expected}”.`;
  }
  return expected ? `Misread: “${expected}”.` : "The word on the tape does not match the page.";
}
