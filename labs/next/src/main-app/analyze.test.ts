import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeFile, analyzeManuscript } from "./analyze";
import { philosophyFixture, epubFixture } from "../../../../src/core/manuscript/fixtures";
import { strToU8, zipSync } from "fflate";

describe("structured book analysis", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("imports nested parts and meditations from a single EPUB document", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 0; } });
    const result = await analyzeFile(new File([philosophyFixture() as Uint8Array<ArrayBuffer>], "philosophy.epub"));
    expect(result.chapters.map(chapter => chapter.title)).toEqual([
      "Prefatory Note", "Part I", "Part II", "Meditation I", "Meditation II", "Appendix",
    ]);
    const html = result.contents.map(content => content.html).join("\n");
    for (const phrase of ["Discourse on the Method", "Meditations on the First Philosophy", "Of Doubt", "final passage"]) {
      expect(html).toContain(phrase);
    }
    expect(html.match(/Reason begins/g)).toHaveLength(1);
    const saved = await analyzeManuscript("philosophy.epub", philosophyFixture());
    expect(saved.chapters.map(c => c.title)).toEqual(result.chapters.map(c => c.title));
    expect(saved.contents.map(c => c.html)).toEqual(result.contents.map(c => c.html));
  });

  it("uses EPUB navigation anchors even when chapters have no heading tags", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 0; } });
    const bytes = epubFixture({ "book.xhtml": '<html><body><p id="a">First body.</p><p id="b">Second body.</p></body></html>' }, {
      nav: '<ol><li><a href="book.xhtml#a">Arrival</a></li><li><a href="book.xhtml#b">Departure</a></li></ol>',
    });
    const result = await analyzeFile(new File([bytes as Uint8Array<ArrayBuffer>], "book.epub"));
    expect(result.chapters.map(c => c.title)).toEqual(["Arrival", "Departure"]);
    expect(result.contents[0].html).toContain("First body.");
    expect(result.contents[0].html).not.toContain("Second body.");
  });

  it("respects arbitrary Word heading styles and preserves short chapters", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 0; } });
    const bytes = zipSync({ "word/document.xml": strToU8(`<w:document xmlns:w="x"><w:body>${["Arrival", "Departure", "Home"].map(title => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p><w:p><w:r><w:t>Yes.</w:t></w:r></w:p>`).join("")}</w:body></w:document>`) });
    const result = await analyzeFile(new File([bytes as Uint8Array<ArrayBuffer>], "book.docx"));
    expect(result.chapters.map(c => c.title)).toEqual(["Arrival", "Departure", "Home"]);
    expect(result.contents.every(c => c.html.includes("Yes."))).toBe(true);
  });

  it("does not strip literal emphasis markers from EPUB prose", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 0; } });
    const bytes = epubFixture({ "a.xhtml": '<html><body><h1>Symbols</h1><p>Use *stars* and _underscores_.</p></body></html>' });
    expect((await analyzeManuscript("book.epub", bytes)).contents[0].html).toContain("Use *stars* and _underscores_.");
  });

  it("preserves DOCX run emphasis in the teleprompter", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 0; } });
    const bytes = zipSync({ "word/document.xml": strToU8('<w:document xmlns:w="x"><w:body><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Quiet</w:t></w:r><w:r><w:t> and </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>loud</w:t></w:r></w:p></w:body></w:document>') });
    expect((await analyzeManuscript("book.docx", bytes)).contents[0].html).toContain("<em>Quiet</em> and <strong>loud</strong>");
  });
});

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
