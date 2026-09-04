const { extractPdfText } = require("./pdf-text.cjs");

describe("PDF manuscript extraction", () => {
  it("prefers the Markdown structure produced by the bundled MarkItDown helper", async () => {
    const text = await extractPdfText({
      sourcePath: "/tmp/book.pdf",
      convert: async () => "# The Arrival\n\nOpening line.",
      resolveCommand: () => {
        throw new Error("pdftotext should not run");
      },
    });
    expect(text).toBe("# The Arrival\n\nOpening line.");
  });

  it("falls back to pdftotext when MarkItDown cannot extract the PDF", async () => {
    const text = await extractPdfText({
      sourcePath: "/tmp/book.pdf",
      convert: async () => null,
      resolveCommand: () => "/tmp/pdftotext",
      run: async (command, args) => {
        expect(command).toBe("/tmp/pdftotext");
        expect(args).toEqual(["-layout", "/tmp/book.pdf", "-"]);
        return Buffer.from("Chapter 1\n\nOpening line.\n");
      },
    });
    expect(text).toBe("Chapter 1\n\nOpening line.\n");
  });
});
