import { describe, expect, it } from "vitest";
import { PROOF_CORPUS } from "./corpus";
import { runEvalCase, runEvalSuite } from "./eval";

describe("proofing accuracy against the labelled corpus", () => {
  const summary = runEvalSuite(PROOF_CORPUS);

  it("raises no pickup that the labels did not ask for", () => {
    const offenders = summary.cases
      .filter((result) => result.falsePositives > 0)
      .map((result) => `${result.name}: ${result.spurious.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("finds every labelled problem", () => {
    const offenders = summary.cases
      .filter((result) => result.falseNegatives > 0)
      .map((result) => `${result.name}: missed ${result.missed.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("scores a perfect run on the corpus", () => {
    expect(summary.precision).toBe(1);
    expect(summary.recall).toBe(1);
  });

  it("covers the cases that used to produce false pickups", () => {
    const cleanCases = PROOF_CORPUS.filter(
      (testCase) => testCase.expected.length === 0 && (testCase.expectedPauses ?? []).length === 0,
    );
    expect(cleanCases.length).toBeGreaterThanOrEqual(10);
  });

  it("reports the offending pickups when a case regresses", () => {
    const result = runEvalCase({
      name: "deliberately mislabelled",
      manuscript: "The door opened.",
      heard: [["The", 0.1, 0.4], ["window", 0.5, 0.8], ["opened", 0.9, 1.2]],
      expected: [],
    });
    expect(result.falsePositives).toBe(1);
    expect(result.spurious[0]).toContain("window");
  });
});
