const SEATS = new Set(["narration", "N1", "N2"]);
const KINDS = new Set(["skip", "insert", "sub", "pause"]);
const STATUSES = new Set(["open", "done", "ignored"]);

function normalizeAlignment(value, chapterId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Alignment file must contain an object");
  }
  if (value.chapter_id !== undefined && value.chapter_id !== chapterId) {
    throw new Error("Alignment file belongs to another chapter");
  }
  if (value.schema !== undefined && value.schema !== 1) {
    throw new Error("Alignment file has an unsupported schema");
  }
  return {
    ...value,
    chapter_id: chapterId,
    transcript: normalizeTranscript(value.transcript ?? []),
    pickups: normalizePickups(value.pickups ?? [], chapterId),
  };
}

function normalizeTranscript(value) {
  if (!Array.isArray(value)) {
    throw new Error("Alignment transcript must be an array");
  }
  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  return value.map((word, position) => {
    if (
      !word
      || typeof word !== "object"
      || typeof word.text !== "string"
      || word.text.trim().length === 0
      || !Number.isFinite(word.start)
      || !Number.isFinite(word.end)
      || word.start < 0
      || word.end < word.start
    ) {
      throw new Error(`Alignment transcript word ${position + 1} is malformed`);
    }
    if (word.start < previousStart || word.end < previousEnd) {
      throw new Error(`Alignment transcript word ${position + 1} is out of order`);
    }
    previousStart = word.start;
    previousEnd = word.end;
    const confidence = Number.isFinite(word.confidence)
      ? Math.min(1, Math.max(0, word.confidence))
      : 0;
    return { ...word, confidence };
  });
}

function normalizePickups(value, chapterId) {
  if (!Array.isArray(value)) {
    throw new Error("Alignment pickups must be an array");
  }
  const ids = new Set();
  return value.map((pickup, position) => {
    if (!pickup || typeof pickup !== "object") {
      throw new Error(`Alignment pickup ${position + 1} must be an object`);
    }
    if (typeof pickup.id !== "string" || pickup.id.length === 0) {
      throw new Error(`Alignment pickup ${position + 1} is missing an id`);
    }
    if (ids.has(pickup.id)) {
      throw new Error(`Alignment pickup id is duplicated: ${pickup.id}`);
    }
    ids.add(pickup.id);
    if (pickup.chapter_id !== chapterId) {
      throw new Error(`Alignment pickup ${pickup.id} belongs to another chapter`);
    }
    if (
      !Number.isFinite(pickup.t_start)
      || !Number.isFinite(pickup.t_end)
      || pickup.t_start < 0
      || pickup.t_end < pickup.t_start
    ) {
      throw new Error(`Alignment pickup ${pickup.id} has invalid timing`);
    }
    if (typeof pickup.expected !== "string" || typeof pickup.heard !== "string") {
      throw new Error(`Alignment pickup ${pickup.id} needs expected and heard text`);
    }
    if (!KINDS.has(pickup.kind) || !SEATS.has(pickup.seat) || !STATUSES.has(pickup.status)) {
      throw new Error(`Alignment pickup ${pickup.id} has an invalid workflow value`);
    }
    if (pickup.note !== undefined && typeof pickup.note !== "string") {
      throw new Error(`Alignment pickup ${pickup.id} has an invalid note`);
    }
    return {
      ...pickup,
      confidence: Number.isFinite(pickup.confidence)
        ? Math.min(1, Math.max(0, pickup.confidence))
        : 0,
    };
  });
}

module.exports = { normalizeAlignment, normalizePickups, normalizeTranscript };
