import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { fromPlainText, importManuscriptBytes } from "./import";

describe("offline manuscript format import", () => {
  it("preserves DOCX run styles and paragraph breaks", () => {
    const documentXml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter 1</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Italic name</w:t></w:r><w:r><w:rPr><w:b/><w:u w:val="single"/><w:highlight w:val="yellow"/></w:rPr><w:t> bold</w:t></w:r></w:p>
    </w:body></w:document>`;
    const bytes = zipSync({ "word/document.xml": strToU8(documentXml) });

    const imported = importManuscriptBytes(bytes, ".docx");
    expect(imported.format).toBe("docx");
    expect(imported.text).toContain("Chapter 1\nItalic name bold");
    expect(imported.spans).toEqual([
      expect.objectContaining({ text: "Chapter 1", style: [] }),
      expect.objectContaining({ text: "\n", style: [] }),
      expect.objectContaining({ text: "Italic name", style: ["italic"] }),
      expect.objectContaining({ text: " bold", style: ["bold", "underline", "highlight"] }),
    ]);
  });

  it("extracts readable body text from EPUB XHTML in deterministic order", () => {
    const bytes = zipSync({
      "OEBPS/02.xhtml": strToU8("<html><body><h1>Chapter 2</h1><p>Second &amp; final.</p></body></html>"),
      "OEBPS/01.xhtml": strToU8("<html><body><h1>Chapter 1</h1><p>First.</p></body></html>"),
    });
    const imported = importManuscriptBytes(bytes, "epub");
    expect(imported.format).toBe("epub");
    expect(imported.text).toBe("Chapter 1\nFirst.\nChapter 2\nSecond & final.");
    expect(imported.spans).toHaveLength(1);
  });

  it("normalizes plain text and rejects unknown formats", () => {
    expect(importManuscriptBytes(strToU8("\ufeffA\r\nB"), ".txt").text).toBe("A\nB");
    expect(() => importManuscriptBytes(strToU8("x"), ".pages")).toThrow(/unsupported/i);
  });

  it("marks quoted dialogue without assigning a narrator seat", () => {
    const imported = fromPlainText('Mara said, "Stay here." Then she said, ‘I couldn’t leave.’', "txt");
    expect(imported.spans.some((span) => span.dialogue && span.text.includes("Stay here"))).toBe(true);
    expect(imported.spans.some((span) => span.dialogue && span.text.includes("couldn’t"))).toBe(true);
    expect(imported.spans.some((span) => !span.dialogue && span.text.includes("Then she said"))).toBe(true);
    expect(imported.spans.filter((span) => span.dialogue).every((span) => span.seat === "narration")).toBe(true);
  });
});
