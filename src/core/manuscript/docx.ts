import type { ScriptSpan } from "../project/types";
import type { ManuscriptHeading } from "./split";
import { attribute, children, elements, localName, parseMarkup } from "./xml";
import { decodeManuscriptText } from "./encoding";

export function extractDocx(entries: Record<string, Uint8Array>): { text: string; spans: ScriptSpan[]; headings?: ManuscriptHeading[] } {
  const document = entries["word/document.xml"];
  if (!document) throw new Error("DOCX does not contain word/document.xml");
  const doc = parseMarkup(decodeManuscriptText(document));
  const styles = entries["word/styles.xml"] ? parseMarkup(decodeManuscriptText(entries["word/styles.xml"])) : undefined;
  const styleMap = new Map((styles ? elements(styles, "style") : []).map(style => [attribute(style, "styleid"), style]));
  const headingLevel = (properties: Element | undefined, seen = new Set<string>()): number | undefined => {
    if (!properties) return undefined;
    const outline = elements(properties, "outlinelvl")[0];
    if (outline) {
      const level = Number(attribute(outline, "val"));
      return level >= 0 && level < 9 ? level : undefined;
    }
    const styleId = attribute(elements(properties, "pstyle")[0] ?? elements(properties, "basedon")[0], "val");
    if (!styleId || seen.has(styleId)) return undefined;
    seen.add(styleId);
    const standard = /^Heading([1-6])$/iu.exec(styleId);
    return standard ? Number(standard[1]) - 1 : headingLevel(styleMap.get(styleId), seen);
  };
  const paragraphs = elements(doc, "p").filter(paragraph => !hasAncestor(paragraph, new Set(["del", "movefrom"])));
  const spans: ScriptSpan[] = [];
  const candidates: Array<ManuscriptHeading & { level: number }> = [];
  let offset = 0;
  for (const [index, paragraph] of paragraphs.entries()) {
    if (index > 0) {
      spans.push({ text: "\n", seat: "narration", style: [] });
      offset += 1;
    }
    const paragraphSpans: ScriptSpan[] = [];
    for (const run of elements(paragraph, "r")) {
      if (hasAncestor(run, new Set(["del", "movefrom"]))) continue;
      let owner = run.parentNode;
      while (owner && localName(owner) !== "p") owner = owner.parentNode;
      if (owner !== paragraph) continue; // Text-box paragraphs are read once, separately.
      // Text nodes only: field instructions, comments and deleted revisions
      // must never become words in the narrator's script.
      const text = children(run).map(node => {
        const name = localName(node);
        if (name === "t") return node.textContent ?? "";
        if (name === "tab") return "\t";
        if (name === "br" || name === "cr") return "\n";
        if (name === "nobreakhyphen") return "‑";
        return "";
      }).join("");
      if (text) paragraphSpans.push({ text, seat: "narration", style: runStyle(run) });
    }
    const text = paragraphSpans.map(span => span.text).join("");
    const level = headingLevel(children(paragraph).find(node => localName(node) === "ppr"));
    if (level !== undefined && text.trim()) candidates.push({ title: text.trim(), level, source_start: offset, content_start: offset + text.length });
    spans.push(...paragraphSpans);
    offset += text.length;
  }
  const text = spans.map(span => span.text).join("");
  if (!text.trim()) throw new Error("DOCX contains no readable paragraphs");
  const topLevel = Math.min(...candidates.map(heading => heading.level));
  const headings = candidates.filter(heading => heading.level === topLevel);
  return { text, spans, ...(headings.length ? { headings } : {}) };
}

function hasAncestor(node: Node, names: Set<string>): boolean {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (names.has(localName(parent))) return true;
  }
  return false;
}

function runStyle(run: Element): ScriptSpan["style"] {
  const properties = children(run).find(node => localName(node) === "rpr");
  const style: ScriptSpan["style"] = [];
  if (!properties) return style;
  for (const [tag, value] of [["b", "bold"], ["i", "italic"], ["u", "underline"], ["highlight", "highlight"]] as const) {
    const node = children(properties).find(child => localName(child) === tag);
    if (node && !/^(?:0|false|off|none)$/iu.test(attribute(node, "val"))) style.push(value);
  }
  return style;
}
