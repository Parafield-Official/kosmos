/**
 * Booth tape collected in the main process from live PCM hops.
 *
 * The renderer can unmount when the narrator hits Review or Leave. PCM
 * already flows here for follow, so the tape must live here too.
 */

const LIVE_TAPE_SAMPLE_RATE = 16_000;
const MIN_LIVE_TAPE_SECONDS = 0.3;
const MAX_LIVE_TAPE_SECONDS = 2 * 60 * 60;

function createLiveTape() {
  let chapterId = "";
  let chunks = [];
  let sampleCount = 0;

  return {
    begin(session = {}) {
      chapterId = typeof session.chapterId === "string" ? session.chapterId : "";
      chunks = [];
      sampleCount = 0;
    },
    append(samples) {
      if (!samples || samples.length === 0) {
        return;
      }
      const copy = samples instanceof Float32Array ? samples : Float32Array.from(samples);
      chunks.push(copy);
      sampleCount += copy.length;
    },
    seconds() {
      return sampleCount / LIVE_TAPE_SAMPLE_RATE;
    },
    shouldKeep() {
      const seconds = sampleCount / LIVE_TAPE_SAMPLE_RATE;
      return seconds >= MIN_LIVE_TAPE_SECONDS && seconds <= MAX_LIVE_TAPE_SECONDS;
    },
    encode() {
      const audio = require("../dist-core/audio.cjs");
      return audio.encodeWavPcm16(concat(chunks, sampleCount), LIVE_TAPE_SAMPLE_RATE, 1);
    },
    take() {
      const snapshot = {
        chapterId,
        samples: concat(chunks, sampleCount),
        sampleRate: LIVE_TAPE_SAMPLE_RATE,
      };
      chapterId = "";
      chunks = [];
      sampleCount = 0;
      return snapshot;
    },
  };
}

function concat(chunks, total) {
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function float32FromPcmBase64(base64) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength < 4 || bytes.byteLength % 4 !== 0) {
    return new Float32Array(0);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

module.exports = {
  LIVE_TAPE_SAMPLE_RATE,
  createLiveTape,
  float32FromPcmBase64,
};
