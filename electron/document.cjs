const SEATS = new Set(["narration", "N1", "N2"]);
const STYLES = new Set(["bold", "italic", "underline", "highlight"]);
const PERFORMANCE_CUES = new Set(["beat", "breath", "emphasis", "character", "intention"]);

function normalizePerformanceCue(value) {
  if (!value || typeof value !== "object" || !PERFORMANCE_CUES.has(value.kind)) {
    return null;
  }
  const label = typeof value.label === "string" ? value.label.trim().slice(0, 160) : "";
  return { kind: value.kind, ...(label ? { label } : {}) };
}

function normalizeChapterDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.spans)) {
    throw new Error("Chapter script must contain a spans array");
  }
  if (value.schema !== undefined && value.schema !== 1) {
    throw new Error("Chapter script has an unsupported schema");
  }
  return {
    ...value,
    schema: value.schema ?? 1,
    spans: value.spans.map((span, position) => {
      if (!span || typeof span !== "object" || typeof span.text !== "string" || !SEATS.has(span.seat)) {
        throw new Error(`Chapter script span ${position + 1} is malformed`);
      }
      const style = Array.isArray(span.style)
        ? span.style.filter((candidate) => STYLES.has(candidate))
        : [];
      const performanceCue = normalizePerformanceCue(span.performance_cue);
      return {
        text: span.text,
        seat: span.seat,
        style,
        ...(typeof span.dialogue === "boolean" ? { dialogue: span.dialogue } : {}),
        ...(typeof span.glossary_id === "string" && span.glossary_id.length > 0
          ? { glossary_id: span.glossary_id }
          : {}),
        ...(performanceCue ? { performance_cue: performanceCue } : {}),
      };
    }),
  };
}

module.exports = { normalizeChapterDocument };
