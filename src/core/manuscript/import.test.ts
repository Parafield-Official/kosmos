import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { fromPlainText, importManuscriptBytes, splitImportedManuscript } from "./import";
import { epubFixture } from "./fixtures";

describe("offline manuscript format import", () => {
  it("reads NCX anchors, encoded paths and HTML media types in spine order", () => {
    const bytes = epubFixture({
      "later.html": '<html><body><h1>Last</h1><p>The last passage.</p></body></html>',
      "book one.xhtml": '<html><body><p id="first">First passage.</p><p id="second">Second passage.</p></body></html>',
    }, { spine: ["book one.xhtml", "later.html"], ncx: '<navPoint><navLabel><text>Opening</text></navLabel><content src="book%20one.xhtml#first"/></navPoint><navPoint><navLabel><text>Continuation</text></navLabel><content src="book%20one.xhtml#second"/></navPoint>' });
    const chapters = splitImportedManuscript(importManuscriptBytes(bytes, "epub"));
    expect(chapters.map(c => c.title)).toEqual(["Opening", "Continuation", "Last"]);
    expect(chapters.map(c => c.text)).toEqual(["First passage.", "Second passage.", "The last passage."]);
  });

  it("retains internal headings when the TOC only links to a whole document", () => {
    const bytes = epubFixture({ "book.xhtml": '<html><body><h1>Collected Stories</h1><h2>Arrival</h2><p>First body.</p><h2>Departure</h2><p>Second body.</p></body></html>' }, {
      nav: '<ol><li><a href="book.xhtml">Collected Stories</a></li></ol>',
    });
    expect(splitImportedManuscript(importManuscriptBytes(bytes, "epub")).map(c => c.title)).toEqual(["Arrival", "Departure"]);
  });

  it("recovers real headings from a partially broken table of contents", () => {
    const bytes = epubFixture({ "book.xhtml": '<html><body><h2 id="a">Arrival</h2><p>First body.</p><h2 id="b">Departure</h2><p>Second body.</p></body></html>' }, {
      nav: '<ol><li><a href="book.xhtml#a">Arrival</a></li><li><a href="book.xhtml#missing">Departure</a></li></ol>',
    });
    expect(splitImportedManuscript(importManuscriptBytes(bytes, "epub")).map(c => c.title)).toEqual(["Arrival", "Departure"]);
  });

  it("resolves navigation IDs inside a heading to the complete heading", () => {
    const bytes = epubFixture({ "book.xhtml": '<html><body><h2>Chapter <span id="a">I</span></h2><p>First body.</p><h2>Chapter <span id="b">II</span></h2><p>Second body.</p></body></html>' }, {
      nav: '<ol><li><a href="book.xhtml#a">Chapter I</a></li><li><a href="book.xhtml#b">Chapter II</a></li></ol>',
    });
    const chapters = splitImportedManuscript(importManuscriptBytes(bytes, "epub"));
    expect(chapters.map(c => c.title)).toEqual(["Chapter I", "Chapter II"]);
    expect(chapters.map(c => c.text)).toEqual(["First body.", "Second body."]);
  });

  it("keeps subtitles with their chapter and excludes navigation lists from narration", () => {
    const bytes = epubFixture({ "book.xhtml": '<html><body><nav><a href="#a">Navigation residue</a></nav><section id="a"><hgroup><h2>Meditation I</h2><p>Of Doubt</p></hgroup><p>First body.</p></section><h2>Appendix</h2><p>Final body.</p></body></html>' });
    const imported = importManuscriptBytes(bytes, "epub");
    const chapters = splitImportedManuscript(imported);
    expect(chapters.map(c => c.title)).toEqual(["Meditation I", "Appendix"]);
    expect(chapters[0].heading_text).toBe("Meditation I\nOf Doubt");
    expect(chapters[0].text).toBe("First body.");
    expect(imported.text).not.toContain("Navigation residue");
  });

  it("does not turn lower-level EPUB subheadings into extra chapters", () => {
    const epub = epubFixture({ "book.xhtml": '<html><body><h1>Arrival</h1><p>First body.</p><h2>Scene one</h2><p>More prose.</p><h1>Departure</h1><p>Second body.</p><h2>Scene two</h2><p>Final prose.</p></body></html>' });
    const chapters = splitImportedManuscript(importManuscriptBytes(epub, "epub"));
    expect(chapters.map(c => c.title)).toEqual(["Arrival", "Departure"]);
    expect(chapters[0].text).toContain("Scene one");
  });

  it("does not reinterpret chapter-looking prose or literal Markdown in an EPUB", () => {
    const bytes = epubFixture({ "book.xhtml": '<html><body><h1>Arrival</h1><p>Chapter books are often illustrated.</p><p>Keep *literal* symbols and &amp;lt;entities&amp;gt;.</p></body></html>' });
    const chapters = splitImportedManuscript(importManuscriptBytes(bytes, "epub"));
    expect(chapters).toHaveLength(1);
    expect(chapters[0].text).toContain("*literal* symbols and &lt;entities&gt;");
  });

  it("uses namespaced OPF/XHTML and extensionless manifest documents", () => {
    const bytes = zipSync({
      "META-INF/container.xml": strToU8('<c:container xmlns:c="urn:container"><c:rootfile full-path="OPS/book.opf"/></c:container>'),
      "OPS/book.opf": strToU8('<o:package xmlns:o="urn:opf"><o:manifest><o:item id="a" href="chapter" media-type="application/xhtml+xml"/></o:manifest><o:spine><o:itemref idref="a"/></o:spine></o:package>'),
      "OPS/chapter": strToU8('<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:body><x:h1>Été</x:h1><x:p>First<br/>Second</x:p></x:body></x:html>'),
    });
    expect(splitImportedManuscript(importManuscriptBytes(bytes, "epub"))[0]).toMatchObject({ title: "Été", text: "First\nSecond" });
  });

  it("rejects a partial EPUB instead of silently omitting a missing spine document", () => {
    const bytes = zipSync({
      "book.opf": strToU8('<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'),
      "a.xhtml": strToU8('<html><body><p>First.</p></body></html>'),
    });
    expect(() => importManuscriptBytes(bytes, "epub")).toThrow(/missing/i);
  });

  it("reads custom Word outline styles and alternate namespace prefixes without field codes", () => {
    const bytes = zipSync({
      "word/styles.xml": strToU8('<d:styles xmlns:d="urn:word"><d:style d:styleId="BookHeading"><d:pPr><d:outlineLvl d:val="0"/></d:pPr></d:style></d:styles>'),
      "word/document.xml": strToU8('<d:document xmlns:d="urn:word"><d:body><d:p><d:pPr><d:pStyle d:val="BookHeading"/></d:pPr><d:r><d:t>Arrival</d:t></d:r></d:p><d:p><d:r><d:instrText>HYPERLINK ignored</d:instrText></d:r></d:p><d:p><d:r><d:t>Visible &amp;lt;word&amp;gt;.</d:t></d:r></d:p></d:body></d:document>'),
    });
    const chapters = splitImportedManuscript(importManuscriptBytes(bytes, "docx"));
    expect(chapters[0]).toMatchObject({ title: "Arrival", text: "Visible &lt;word&gt;." });
  });

  it("does not duplicate text-box paragraphs or include deleted Word revisions", () => {
    const bytes = zipSync({ "word/document.xml": strToU8('<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Outer.</w:t></w:r><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Inner.</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p><w:p><w:del><w:r><w:delText>Deleted.</w:delText></w:r></w:del><w:r><w:t>Kept.</w:t></w:r></w:p></w:body></w:document>') });
    expect(importManuscriptBytes(bytes, "docx").text).toBe("Outer.\nInner.\nKept.");
  });

  it("keeps Word subheadings inside their top-level chapter and preserves styled offsets", () => {
    const bytes = zipSync({ "word/document.xml": strToU8('<w:document xmlns:w="x"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Arrival</w:t></w:r></w:p><w:p><w:r><w:t>First body.</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>A closer look</w:t></w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Details.</w:t></w:r></w:p></w:body></w:document>') });
    const imported = importManuscriptBytes(bytes, "docx");
    const chapters = splitImportedManuscript(imported);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].text).toBe("First body.\nA closer look\nDetails.");
    expect(imported.text.slice(chapters[0].content_start, chapters[0].content_end)).toBe(chapters[0].text);
    expect(imported.spans.map(span => span.text).join("")).toBe(imported.text);
  });

  it("decodes UTF-16 manuscripts exported by Windows editors", () => {
    const text = "Chapter 1\r\nCafé.";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([255, 254]);
    const view = new DataView(bytes.buffer);
    Array.from(text).forEach((character, index) => view.setUint16(2 + index * 2, character.charCodeAt(0), true));
    expect(importManuscriptBytes(bytes, "txt").text).toBe("Chapter 1\nCafé.");
  });
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

  it("keeps the plain-text source available for hash chapter splitting", () => {
    const imported = importManuscriptBytes(strToU8("# Leaflets\n\nThe opening."), ".txt");
    expect(imported.source_text).toBe("# Leaflets\n\nThe opening.");
    expect(imported.text).not.toContain("# Leaflets");
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
