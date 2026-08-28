import { unzipSync } from "fflate";

/** Title and author(s) detected from a manuscript's own metadata. */
export interface ManuscriptMeta {
  title?: string;
  authors?: string[];
}

/** Split a byline into individual authors, tolerating "A & B", "A and B", etc. */
export function splitAuthors(raw: string): string[] {
  return raw
    .split(/\s*(?:,|&|;|\/|\band\b)\s*/i)
    .map((part) => part.trim().replace(/[.]+$/, ""))
    .filter((part) => part.length > 1 && part.length < 60)
    .slice(0, 6);
}

const DUBLIN_CORE_NS = "http://purl.org/dc/elements/1.1/";

/** Read Dublin Core title/creator from an EPUB OPF or a DOCX core.xml document. */
function metaFromDublinCore(doc: Document): ManuscriptMeta {
  const elements = (name: string): Element[] => {
    const namespaced = Array.from(doc.getElementsByTagNameNS(DUBLIN_CORE_NS, name));
    return namespaced.length ? namespaced : Array.from(doc.getElementsByTagName(`dc:${name}`));
  };
  const title = elements("title")[0]?.textContent?.trim() || undefined;
  const creators = elements("creator")
    .map((element) => element.textContent?.trim() ?? "")
    .filter(Boolean);
  // Separate <dc:creator> elements are already one author each; a single field
  // may still pack several names ("A & B"), so let splitAuthors handle that.
  const authors = creators.length > 1 ? creators.slice(0, 6) : splitAuthors(creators[0] ?? "");
  return { title, authors: authors.length ? authors : undefined };
}

/** Pull title/author from EPUB bytes by resolving the OPF via META-INF/container.xml. */
export function epubMetaFromBytes(bytes: Uint8Array): ManuscriptMeta {
  try {
    const entries = unzipSync(bytes);
    const decoder = new TextDecoder();
    let opfPath: string | null = null;
    const container = entries["META-INF/container.xml"];
    if (container) {
      const xml = new DOMParser().parseFromString(decoder.decode(container), "application/xml");
      opfPath = xml.querySelector("rootfile")?.getAttribute("full-path") ?? null;
    }
    if (!opfPath || !entries[opfPath]) {
      opfPath = Object.keys(entries).find((name) => /\.opf$/i.test(name)) ?? null;
    }
    if (!opfPath || !entries[opfPath]) {
      return {};
    }
    const opf = new DOMParser().parseFromString(decoder.decode(entries[opfPath]), "application/xml");
    return metaFromDublinCore(opf);
  } catch {
    return {};
  }
}

/** Pull title/author from DOCX bytes via docProps/core.xml (also Dublin Core). */
export function docxMetaFromBytes(bytes: Uint8Array): ManuscriptMeta {
  try {
    const core = unzipSync(bytes)["docProps/core.xml"];
    if (!core) {
      return {};
    }
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(core), "application/xml");
    return metaFromDublinCore(xml);
  } catch {
    return {};
  }
}

/** Light heuristic: pull a title and author(s) from the top of a text manuscript. */
export function textMeta(text: string): ManuscriptMeta {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);

  let title: string | undefined;
  let authors: string[] | undefined;

  for (const line of lines) {
    if (!title) {
      const titled = line.match(/^title\s*[:\-–]\s*(.+)$/i);
      if (titled) {
        title = titled[1].trim();
        continue;
      }
    }
    if (!authors) {
      const labelled = line.match(/^authors?\s*[:\-–]\s*(.+)$/i);
      if (labelled) {
        authors = splitAuthors(labelled[1]);
        continue;
      }
      const byline = line.match(/^by\s+(.{2,60})$/i);
      if (byline && byline[1].split(/\s+/).length <= 10) {
        authors = splitAuthors(byline[1]);
      }
    }
  }

  return { title, authors: authors && authors.length ? authors : undefined };
}

function extension(name: string): string {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match ? match[1] : "";
}

/** Detect title/author from a manuscript's bytes, using each format's metadata. */
export function manuscriptMetaFromBytes(name: string, bytes: Uint8Array): ManuscriptMeta {
  const ext = extension(name);
  if (ext === "epub") {
    return epubMetaFromBytes(bytes);
  }
  if (ext === "docx") {
    return docxMetaFromBytes(bytes);
  }
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    try {
      return textMeta(new TextDecoder().decode(bytes));
    } catch {
      return {};
    }
  }
  return {};
}
