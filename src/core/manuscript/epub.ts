import { decodeManuscriptText } from "./encoding";
import { readArchiveEntries } from "./archive";
import { attribute, children, compactText, elements, localName, parseMarkup } from "./xml";
import type { ManuscriptHeading } from "./split";

interface NavigationTarget { path: string; fragment: string; title: string }

function decodePath(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function resolveEpubPath(base: string, href: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href)) return "";
  const relative = decodePath(href.split(/[?#]/u, 1)[0]).replaceAll("\\", "/");
  const path = relative.startsWith("/") ? relative : base.slice(0, base.lastIndexOf("/") + 1) + relative;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export function epubPackagePath(entries: Record<string, Uint8Array>): string | undefined {
  const container = Object.keys(entries).find(name => name.toLowerCase() === "meta-inf/container.xml");
  if (container) {
    const path = attribute(elements(parseMarkup(decodeManuscriptText(entries[container])), "rootfile")[0], "full-path");
    const resolved = resolveEpubPath("", path);
    if (entries[resolved]) return resolved;
  }
  return Object.keys(entries).filter(name => /\.opf$/iu.test(name)).sort()[0];
}

export function readEpubMetadata(bytes: Uint8Array): Record<string, Uint8Array> {
  return readArchiveEntries(bytes, name => /(?:^meta-inf\/container\.xml$|\.opf$)/iu.test(name), { maxBytes: 10 * 1024 * 1024 });
}

function semanticTokens(element: Element): string[] {
  return `${element.getAttribute("epub:type") ?? ""} ${element.getAttribute("role") ?? ""}`.split(/\s+/u);
}

function navigationTargets(doc: Document, path: string): NavigationTarget[] {
  const targets: NavigationTarget[] = [];
  const add = (href: string, title: string) => {
    if (!href || !title) return;
    targets.push({
      path: href.startsWith("#") ? path : resolveEpubPath(path, href),
      fragment: decodePath(href.includes("#") ? href.slice(href.indexOf("#") + 1) : ""),
      title,
    });
  };
  for (const nav of elements(doc, "nav").filter(el => semanticTokens(el).some(type => type === "toc" || type === "doc-toc"))) {
    for (const anchor of elements(nav, "a")) add(anchor.getAttribute("href") ?? "", compactText(anchor));
  }
  for (const point of elements(doc, "navpoint")) {
    const content = children(point).find(el => localName(el) === "content");
    const label = children(point).find(el => localName(el) === "navlabel");
    add(content?.getAttribute("src") ?? "", compactText(label));
  }
  return targets;
}

interface RenderedDocument {
  text: string;
  ranges: Map<Element, { start: number; end: number }>;
}

const BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "section", "article", "header", "hgroup", "tr", "table", "ul", "ol", "dl", "dt", "dd", "pre"]);
const NOISE = new Set(["head", "script", "style", "nav", "noscript", "template"]);

/** Render DOM text with real block boundaries, retaining offsets for all IDs. */
function renderBody(body: Element): RenderedDocument {
  let text = "";
  const ranges: RenderedDocument["ranges"] = new Map();
  const newline = () => { text = text.trimEnd(); if (text && !text.endsWith("\n")) text += "\n"; };
  const visit = (node: Node): void => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const value = (node.nodeValue ?? "").replace(/[\t\r\n ]+/gu, " ");
      text += !text || /[\n ]$/u.test(text) ? value.replace(/^ /u, "") : value;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const name = localName(element);
    if (NOISE.has(name)) return;
    if (name === "br") { newline(); return; }
    const block = BLOCKS.has(name);
    if (block) newline();
    const start = text.length;
    for (const child of Array.from(node.childNodes)) visit(child);
    if (block) newline();
    if (name === "td" || name === "th") text += " ";
    ranges.set(element, { start, end: text.trimEnd().length });
  };
  visit(body);
  return { text: text.trimEnd(), ranges };
}

function documentHeadings(doc: Document, rendered: RenderedDocument, targets: NavigationTarget[], defaultTitle: string): ManuscriptHeading[] {
  const nodes = elements(doc, "*");
  const headingNodes = nodes.filter(node => /^h[1-6]$/u.test(localName(node)) && rendered.ranges.has(node));
  const ids = new Map(nodes.filter(node => node.hasAttribute("id")).map(node => [node.getAttribute("id"), node]));
  const boundaries = new Map<number, ManuscriptHeading>();
  const add = (node: Element, label: string) => {
    for (let parent = node.parentNode; parent?.nodeType === 1; parent = parent.parentNode) {
      if (/^h[1-6]$/u.test(localName(parent))) {
        node = parent as Element;
        break;
      }
    }
    const range = rendered.ranges.get(node);
    if (!range) return;
    const firstHeading = /^h[1-6]$/u.test(localName(node)) ? node
      : headingNodes.find(heading => {
        const candidate = rendered.ranges.get(heading)!;
        return candidate.start === range.start && candidate.end <= range.end;
      });
    const headingContainer = firstHeading?.parentNode && localName(firstHeading.parentNode) === "hgroup"
      ? firstHeading.parentNode as Element : firstHeading;
    const headingRange = headingContainer ? rendered.ranges.get(headingContainer) : undefined;
    const title = firstHeading ? compactText(firstHeading) : label;
    if (title) boundaries.set(range.start, {
      title, source_start: range.start, content_start: headingRange?.end ?? range.start,
      ...(headingRange && headingContainer !== firstHeading ? { heading_text: rendered.text.slice(headingRange.start, headingRange.end) } : {}),
    });
  };
  // TOC links are authoritative for internal sections; ignore page-list/landmarks.
  for (const target of targets) {
    const node = target.fragment ? ids.get(target.fragment) : elements(doc, "body")[0];
    if (node) add(node, target.title);
  }
  const fragments = targets.filter(target => target.fragment);
  if (boundaries.size === 0 || fragments.length === 0 || fragments.some(target => !ids.has(target.fragment))) {
    // A file-level TOC entry can contain a whole book. Prefer semantic chapters,
    // then the highest repeated heading level; retain the enclosing titles.
    const semantic = headingNodes.filter(node => {
      const parent = node.parentNode && localName(node.parentNode) === "hgroup" ? node.parentNode.parentNode : node.parentNode;
      return parent?.nodeType === 1 && semanticTokens(parent as Element)
        .some(type => /^(?:doc-)?(?:chapter|part|preface|dedication|foreword|introduction|appendix|afterword|epilogue|prologue)$/u.test(type));
    });
    const counts = new Map<number, number>();
    for (const heading of headingNodes) {
      const level = Number(localName(heading).slice(1));
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    const repeated = Math.min(...Array.from(counts).filter(([, count]) => count > 1).map(([level]) => level));
    const semanticLevel = Math.min(...semantic.map(node => Number(localName(node).slice(1))));
    for (const heading of headingNodes) {
      const level = Number(localName(heading).slice(1));
      const isChapter = semantic.length ? semantic.includes(heading) || level < semanticLevel : level <= repeated;
      if (isChapter) add(heading, compactText(heading));
    }
  }
  if (!boundaries.has(0) && rendered.text.trim()) {
    const firstHeading = headingNodes.find(node => rendered.ranges.get(node)?.start === 0);
    if (firstHeading) add(firstHeading, compactText(firstHeading));
    else boundaries.set(0, { title: defaultTitle, source_start: 0, content_start: 0 });
  }
  return Array.from(boundaries.values()).sort((a, b) => a.source_start - b.source_start);
}

export function extractEpub(bytes: Uint8Array): { text: string; headings: ManuscriptHeading[] } {
  const metadata = readEpubMetadata(bytes);
  const opfPath = epubPackagePath(metadata);
  const opf = opfPath ? parseMarkup(decodeManuscriptText(metadata[opfPath])) : undefined;
  const manifest = new Map((opf ? elements(opf, "item") : []).map(item => [attribute(item, "id"), {
    path: resolveEpubPath(opfPath ?? "", attribute(item, "href")),
    type: attribute(item, "media-type"),
    nav: attribute(item, "properties").split(/\s+/u).includes("nav"),
  }]));
  const isText = (type: string) => /^(?:application\/(?:xhtml\+xml|xml)|text\/html)$/iu.test(type);
  const extraNames = new Set(Array.from(manifest.values()).filter(item => isText(item.type) || item.type === "application/x-dtbncx+xml").map(item => item.path));
  const entries = readArchiveEntries(bytes, name => /\.(?:xhtml?|html?|ncx)$/iu.test(name) || extraNames.has(name));
  const navigationNames = new Set(Array.from(manifest.values()).filter(item => item.nav || item.type === "application/x-dtbncx+xml").map(item => item.path));
  for (const name of Object.keys(entries)) {
    if (/(?:^|\/)(?:nav|toc)\.(?:xhtml?|html?|ncx)$/iu.test(name)) navigationNames.add(name);
  }
  const targets = Array.from(navigationNames).flatMap(name => entries[name] ? navigationTargets(parseMarkup(decodeManuscriptText(entries[name]), !name.endsWith(".ncx")), name) : []);
  let names: string[] = [];
  for (const ref of opf ? elements(opf, "itemref") : []) {
    const item = manifest.get(attribute(ref, "idref"));
    if (!item) throw new Error("EPUB spine references a missing manifest item.");
    if (item.nav || !isText(item.type)) continue;
    if (!entries[item.path]) throw new Error(`EPUB is missing a reading-order document: ${item.path}`);
    if (!names.includes(item.path)) names.push(item.path);
  }
  if (!names.length) names = Object.keys(entries).filter(name => !navigationNames.has(name) && !name.endsWith(".ncx")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const pieces: string[] = [];
  const headings: ManuscriptHeading[] = [];
  let offset = 0;
  for (const name of names) {
    const doc = parseMarkup(decodeManuscriptText(entries[name]), true);
    const body = elements(doc, "body")[0] ?? doc.documentElement;
    const rendered = renderBody(body);
    if (!rendered.text.trim()) continue;
    const ownTargets = targets.filter(target => target.path === name);
    const title = compactText(elements(doc, "title")[0]) || `Section ${pieces.length + 1}`;
    for (const heading of documentHeadings(doc, rendered, ownTargets, title)) {
      headings.push({ ...heading, source_start: heading.source_start + offset, content_start: heading.content_start + offset });
    }
    pieces.push(rendered.text);
    offset += rendered.text.length + 1;
  }
  if (!pieces.length) throw new Error("EPUB contains no readable text; scanned pages are not supported");
  return { text: pieces.join("\n"), headings };
}
