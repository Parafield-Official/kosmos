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

  it("keeps DOCX tabs and line breaks in their source order", () => {
    const documentXml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
      <w:p><w:r><w:t>Before</w:t><w:br/><w:t>After</w:t><w:tab/><w:t>End</w:t></w:r></w:p>
    </w:body></w:document>`;
    const bytes = zipSync({ "word/document.xml": strToU8(documentXml) });

    expect(importManuscriptBytes(bytes, "docx").text).toBe("Before\nAfter\tEnd");
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

  it("follows the EPUB spine instead of guessing order from filenames", () => {
    const bytes = zipSync({
      "META-INF/container.xml": strToU8(
        `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
      ),
      "OPS/package.opf": strToU8(`
        <package><manifest>
          <item id="late" href="late.xhtml" media-type="application/xhtml+xml"/>
          <item id="early" href="early.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine><itemref idref="early"/><itemref idref="late"/></spine></package>
      `),
      "OPS/late.xhtml": strToU8("<html><body><p>Late</p></body></html>"),
      "OPS/early.xhtml": strToU8("<html><body><p>Early</p></body></html>"),
    });

    expect(importManuscriptBytes(bytes, "epub").text).toBe("Early\nLate");
  });

  it("normalizes plain text and rejects unknown formats", () => {
    expect(importManuscriptBytes(strToU8("\ufeffA\r\nB"), ".txt").text).toBe("A\nB");
    expect(() => importManuscriptBytes(strToU8("x"), ".pages")).toThrow(/unsupported/i);
  });

  it("hides Markdown heading markers without changing source offsets", () => {
    const imported = importManuscriptBytes(
      strToU8("# Chapter 1\n\n## The opening scene\n\nText."),
      ".txt",
    );
    expect(imported.text).not.toContain("# Chapter 1");
    expect(imported.text).not.toContain("## The opening scene");
    expect(imported.text).toContain("The opening scene");
    expect(imported.spans.map((span) => span.text).join("")).toBe(imported.text);
  });

  it("marks quoted dialogue without assigning a narrator seat", () => {
    const imported = fromPlainText('Mara said, "Stay here." Then she said, ‘I couldn’t leave.’', "txt");
    expect(imported.spans.some((span) => span.dialogue && span.text.includes("Stay here"))).toBe(true);
    expect(imported.spans.some((span) => span.dialogue && span.text.includes("couldn’t"))).toBe(true);
    expect(imported.spans.some((span) => !span.dialogue && span.text.includes("Then she said"))).toBe(true);
    expect(imported.spans.filter((span) => span.dialogue).every((span) => span.seat === "narration")).toBe(true);
  });

  it("keeps malformed numeric entities literal instead of crashing the import", () => {
    const bytes = zipSync({
      "OEBPS/01.xhtml": strToU8("<html><body><p>Safe &#x110000; and &#99999999; text.</p></body></html>"),
    });
    expect(() => importManuscriptBytes(bytes, "epub")).not.toThrow();
    expect(importManuscriptBytes(bytes, "epub").text).toContain("&#x110000;");
  });

  it("decodes common HTML entities used by EPUB exports", () => {
    const bytes = zipSync({
      "OEBPS/01.xhtml": strToU8("<html><body><p>A&nbsp;dash &mdash; really &hellip; &ldquo;yes&rdquo;.</p></body></html>"),
    });
    expect(importManuscriptBytes(bytes, "epub").text).toBe("A\u00a0dash — really … “yes”.");
  });

  it("rejects an EPUB with an unreasonable number of text entries before expanding all of them", () => {
    const entries = Object.fromEntries(
      Array.from({ length: 1_001 }, (_value, index) => [
        `OEBPS/${String(index).padStart(4, "0")}.xhtml`,
        strToU8("<html><body><p>word</p></body></html>"),
      ]),
    );
    const bytes = zipSync(entries);

    expect(() => importManuscriptBytes(bytes, "epub")).toThrow(/archive|entries|large/i);
  });
});
