const crypto = require("node:crypto");

/**
 * Wire protocol and invite codes for Kosmos live collaboration.
 *
 * An invite is plain text the narrator can paste into any chat app. It binds
 * one project id to a shared secret; both sides derive the same two spoken
 * words from that secret so a person can verify nobody sits in the middle.
 *
 * Frames are JSON objects exchanged over the peer connection. A collaboration
 * round-trip is: hello -> snapshot-manifest -> need -> chunk* -> snapshot-done
 * -> applied. The receiving side turns a finished snapshot into exactly what
 * a zip pack used to be, so the existing merge engine stays the authority.
 */

const INVITE_PREFIX = "KOSMOS1";
const REPLY_PREFIX = "KOSMOS1R";
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 256 * 1024;
const MAX_MANIFEST_FILES = 5000;
const MAX_PROJECT_NAME_LENGTH = 200;

const WORDS = [
  "amber","anchor","apple","autumn","badge","basil","beacon","birch","bison","blade",
  "bloom","brass","breeze","bridge","bright","bronze","cabin","cactus","canvas","cedar",
  "chalk","cherry","cinder","citrus","clover","cobalt","comet","copper","coral","cosmic",
  "cotton","crane","crayon","crimson","daisy","dawn","delta","denim","diamond","dolphin",
  "driftwood","ember","falcon","fable","fern","fjord","flint","forest","fossil","fox",
  "garnet","ginger","glacier","granite","harbor","hazel","helix","hickory","hollow","indigo",
  "ivory","jasmine","jetty","juniper","kelp","kernel","lagoon","lantern","larch","lighthouse",
  "lily","linen","lotus","lumber","magnet","mango","maple","marble","meadow","mesa",
  "mint","mirage","mosaic","moss","mulberry","nebula","nectar","nickel","north","oak",
  "oasis","obsidian","ocean","olive","onyx","opal","orbit","orchid","otter","oxide",
  "pebble","pepper","petal","pewter","phoenix","pigment","pine","plank","plum","poppy",
  "prairie","quartz","quill","radish","rapid","raven","reef","ribbon","ridge","ripple",
  "river","rosemary","ruby","rust","saffron","sage","salmon","sand","sapling","scarlet",
  "sequoia","shadow","shore","signal","silk","slate","smoke","snowfall","solstice","spruce",
  "starling","stem","stone","stratus","summit","sunset","syrup","talon","tangerine","teak",
  "thicket","thistle","thunder","tidal","timber","topaz","torch","totem","trail","tulip",
  "tundra","turquoise","umbra","valley","velvet","vertex","vine","violet","walnut","warden",
  "waterfall","willow","window","winter","wren","yarrow","yeast","zenith","zephyr","zinc",
];

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function createSecret() {
  return crypto.randomBytes(24).toString("hex");
}

function fingerprintWords(secret) {
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("An invite secret is required");
  }
  const digest = crypto.createHmac("sha256", "kosmos-collab-v1").update(secret).digest();
  const first = WORDS[digest[0]];
  const second = WORDS[digest[1]];
  const third = WORDS[digest[2] % WORDS.length];
  return `${first} ${second} ${third}`;
}

function createInvite({ projectId, projectName, secret, sdp }) {
  validateProjectId(projectId);
  if (typeof projectName !== "string" || projectName.trim().length === 0 || projectName.length > MAX_PROJECT_NAME_LENGTH) {
    throw new Error("An invite needs the book name");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("An invite secret is required");
  }
  const body = {
    v: 1,
    projectId,
    projectName,
    secret,
  };
  if (typeof sdp === "string" && sdp.length > 0) {
    if (sdp.length > 32 * 1024) {
      throw new Error("That invite is too large to paste");
    }
    body.sdp = sdp;
  }
  return `${INVITE_PREFIX}-${base64UrlEncode(JSON.stringify(body))}`;
}

function parseInvite(text) {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith(`${INVITE_PREFIX}-`)) {
    return null;
  }
  try {
    const body = JSON.parse(base64UrlDecode(trimmed.slice(INVITE_PREFIX.length + 1)));
    if (
      !body
      || typeof body !== "object"
      || body.v !== 1
      || typeof body.projectId !== "string"
      || typeof body.projectName !== "string"
      || typeof body.secret !== "string"
      || body.secret.length < 32
    ) {
      return null;
    }
    validateProjectId(body.projectId);
    if (body.projectName.trim().length === 0 || body.projectName.length > MAX_PROJECT_NAME_LENGTH) {
      return null;
    }
    const parsed = { projectId: body.projectId, projectName: body.projectName, secret: body.secret };
    if (typeof body.sdp === "string" && body.sdp.length > 0 && body.sdp.length <= 32 * 1024) {
      parsed.sdp = body.sdp;
    }
    return parsed;
  } catch {
    return null;
  }
}

function createReply({ secret, sdp }) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("A reply needs the invite secret");
  }
  if (typeof sdp !== "string" || sdp.length === 0 || sdp.length > 32 * 1024) {
    throw new Error("A reply needs a connection answer");
  }
  return `${REPLY_PREFIX}-${base64UrlEncode(JSON.stringify({ v: 1, secret, sdp }))}`;
}

function parseReply(text) {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith(`${REPLY_PREFIX}-`)) {
    return null;
  }
  try {
    const body = JSON.parse(base64UrlDecode(trimmed.slice(REPLY_PREFIX.length + 1)));
    if (
      !body
      || typeof body !== "object"
      || body.v !== 1
      || typeof body.secret !== "string"
      || body.secret.length < 32
      || typeof body.sdp !== "string"
      || body.sdp.length === 0
      || body.sdp.length > 32 * 1024
    ) {
      return null;
    }
    return { secret: body.secret, sdp: body.sdp };
  } catch {
    return null;
  }
}

function validateProjectId(projectId) {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(projectId)) {
    throw new Error("A project id is required");
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate any inbound frame before it may touch the project. */
function parseFrame(text) {
  if (typeof text !== "string" || text.length > MAX_FRAME_BYTES) {
    return null;
  }
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(frame) || typeof frame.type !== "string") {
    return null;
  }
  switch (frame.type) {
    case "hello":
      if (typeof frame.name !== "string" || frame.name.length === 0 || frame.name.length > 120) {
        return null;
      }
      if (typeof frame.role !== "string" || !["author", "narrator"].includes(frame.role)) {
        return null;
      }
      return frame;
    case "snapshot-manifest":
      if (!Array.isArray(frame.files) || frame.files.length > MAX_MANIFEST_FILES) {
        return null;
      }
      for (const entry of frame.files) {
        if (
          !isPlainObject(entry)
          || typeof entry.path !== "string"
          || !/^[\w][\w./ -]*$/u.test(entry.path)
          || entry.path.includes("..")
          || typeof entry.sha256 !== "string"
          || !/^[a-f0-9]{64}$/u.test(entry.sha256)
          || !Number.isSafeInteger(entry.size)
          || entry.size < 0
          || entry.size > 2 * 1024 * 1024 * 1024
        ) {
          return null;
        }
      }
      if (!isPlainObject(frame.project)) {
        return null;
      }
      return frame;
    case "need":
      if (!Array.isArray(frame.paths) || frame.paths.length > MAX_MANIFEST_FILES) {
        return null;
      }
      if (!frame.paths.every((path) => typeof path === "string")) {
        return null;
      }
      return frame;
    case "chunk":
      if (
        typeof frame.path !== "string"
        || !Number.isSafeInteger(frame.index)
        || frame.index < 0
        || typeof frame.data !== "string"
        || frame.data.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4
      ) {
        return null;
      }
      return frame;
    case "snapshot-done":
    case "applied":
      return isPlainObject(frame.summary) ? frame : { ...frame, summary: null };
    case "error":
      return typeof frame.message === "string" ? frame : null;
    default:
      return null;
  }
}

module.exports = {
  INVITE_PREFIX,
  REPLY_PREFIX,
  MAX_CHUNK_BYTES,
  WORDS,
  base64UrlDecode,
  base64UrlEncode,
  createInvite,
  createReply,
  createSecret,
  fingerprintWords,
  parseFrame,
  parseInvite,
  parseReply,
};
