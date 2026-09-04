import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeFile } from "./analyze";

describe("PDF manuscript analysis", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never decodes a PDF container as narration text", async () => {
    vi.stubGlobal("window", { setTimeout });
    const pdf = new File([
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /BaseFont /Helvetica >>\nendobj",
    ], "book.pdf", { type: "application/pdf" });

    await expect(analyzeFile(pdf)).rejects.toThrow(/PDF|extract|desktop/i);
  });
});
