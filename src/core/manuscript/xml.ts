import { DOMParser } from "@xmldom/xmldom";

/** Local DOM parsing shared by Node and the renderer; no external entities or IO. */
export function parseMarkup(source: string, html = false): Document {
  // Keep invalid numeric references literal rather than letting the DOM decoder
  // turn them into unrelated characters (or throw outside Unicode's range).
  const safe = source.replace(/&#(x[\da-f]+|\d+);/giu, (original, value: string) => {
    const code = value[0].toLowerCase() === "x" ? Number.parseInt(value.slice(1), 16) : Number(value);
    return code > 0x10ffff || code < 1 || (code >= 0xd800 && code <= 0xdfff)
      ? original.replace("&", "&amp;") : original;
  });
  return new DOMParser({ errorHandler: {
    warning: () => {},
    error: () => {},
    fatalError: () => { throw new Error("Manuscript contains malformed XML."); },
  } }).parseFromString(safe, html ? "text/html" : "application/xml");
}

export function localName(node: Node): string {
  return (node.nodeName.split(":").at(-1) ?? "").toLowerCase();
}

export function elements(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagName("*")).filter(element => name === "*" || localName(element) === name.toLowerCase());
}

export function children(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

export function attribute(element: Element | undefined, name: string): string {
  if (!element) return "";
  return Array.from(element.attributes).find(attr => localName(attr) === name.toLowerCase())?.value ?? "";
}

export function compactText(node: Node | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/gu, " ").trim();
}
