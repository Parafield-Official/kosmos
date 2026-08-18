const MAX_LIVE_AUDIO_BYTES = 8 * 1024 * 1024;

const MIME_EXTENSIONS = new Map([
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/webm", ".webm"],
  ["audio/webm;codecs=opus", ".webm"],
  ["audio/mp4", ".m4a"],
  ["audio/ogg", ".ogg"],
]);

function extensionForMime(mimeType) {
  const normalized = String(mimeType ?? "").split(";", 1)[0].trim().toLocaleLowerCase("en-US");
  return MIME_EXTENSIONS.get(normalized) ?? null;
}

function decodeLiveAudioPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid listen-only audio payload");
  }
  const mimeType = String(payload.mimeType ?? "").trim().toLocaleLowerCase("en-US");
  const extension = extensionForMime(mimeType);
  if (!extension) {
    throw new Error("Listen-only audio must use a supported audio container");
  }
  const encoded = String(payload.audioBase64 ?? "");
  if (encoded.length === 0 || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    throw new Error("Listen-only audio is not valid base64");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) {
    throw new Error("Listen-only audio is empty");
  }
  if (bytes.length > MAX_LIVE_AUDIO_BYTES) {
    throw new Error(`Listen-only audio is too large (maximum ${MAX_LIVE_AUDIO_BYTES} bytes)`);
  }
  return { bytes, mimeType, extension };
}

module.exports = { MAX_LIVE_AUDIO_BYTES, decodeLiveAudioPayload, extensionForMime };
