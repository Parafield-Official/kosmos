import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { epubMetaFromBytes, docxMetaFromBytes } from "./manuscript-meta";
import { readArchiveEntries } from "../../../../src/core/manuscript/archive";

describe("manuscript metadata previews", () => {
  it("resolves namespaced package paths and creator names without a browser DOM", () => {
    const bytes = zipSync({
      "META-INF/container.xml": strToU8('<c:container xmlns:c="urn:container"><c:rootfile full-path="OPS/my%20book.opf"/></c:container>'),
      "OPS/my book.opf": strToU8('<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Reason &amp; Doubt</dc:title><dc:creator>Descartes, René</dc:creator></metadata></package>'),
      "unused/broken.xhtml": strToU8("this is not valid XML"),
    });
    expect(epubMetaFromBytes(bytes)).toEqual({ title: "Reason & Doubt", authors: ["René Descartes"] });
  });

  it("reads only the DOCX metadata entry", () => {
    const bytes = zipSync({
      "docProps/core.xml": strToU8('<core xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Journey</dc:title><dc:creator>Ada Author</dc:creator></core>'),
      "word/document.xml": strToU8("unreadable body"),
    });
    expect(docxMetaFromBytes(bytes)).toEqual({ title: "The Journey", authors: ["Ada Author"] });
  });

  it("applies archive budgets only to selected assets, before decompression", () => {
    const bytes = zipSync({ "cover.png": new Uint8Array(100), "book.opf": strToU8("metadata") });
    expect(Object.keys(readArchiveEntries(bytes, name => name.endsWith(".opf"), { maxBytes: 10 }))).toEqual(["book.opf"]);
    expect(() => readArchiveEntries(bytes, () => true, { maxBytes: 10 })).toThrow(/too large/i);
    expect(() => readArchiveEntries(bytes, () => true, { maxFiles: 1 })).toThrow(/too many/i);
  });
});
