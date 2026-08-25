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
      const initial = session.initialSamples instanceof Float32Array
        ? new Float32Array(session.initialSamples)
        : Array.isArray(session.initialSamples)
          ? Float32Array.from(session.initialSamples)
          : new Float32Array(0);
      chunks = initial.length > 0 ? [initial] : [];
      sampleCount = initial.length;
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
    truncate(endSeconds) {
      const safeSeconds = Number.isFinite(endSeconds) ? Math.max(0, endSeconds) : 0;
      const keep = Math.min(sampleCount, Math.round(safeSeconds * LIVE_TAPE_SAMPLE_RATE));
      const retained = concat(chunks, sampleCount).slice(0, keep);
      chunks = retained.length > 0 ? [retained] : [];
      sampleCount = retained.length;
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

/** Convert a previously saved tape to the 16 kHz mono clock used by live ingest. */
function normalizeLiveTapePcm(samples, sampleRate, channels) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  const safeChannels = Number.isInteger(channels) && channels > 0 ? channels : 1;
  const frameCount = Math.floor(source.length / safeChannels);
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < safeChannels; channel += 1) {
      sum += source[frame * safeChannels + channel] ?? 0;
    }
    mono[frame] = sum / safeChannels;
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate === LIVE_TAPE_SAMPLE_RATE || mono.length === 0) {
    return mono;
  }
  const output = new Float32Array(Math.max(1, Math.round(mono.length * LIVE_TAPE_SAMPLE_RATE / sampleRate)));
  const ratio = sampleRate / LIVE_TAPE_SAMPLE_RATE;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = mono[Math.min(mono.length - 1, left)] ?? 0;
    const b = mono[Math.min(mono.length - 1, left + 1)] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

module.exports = {
  LIVE_TAPE_SAMPLE_RATE,
  createLiveTape,
  float32FromPcmBase64,
  normalizeLiveTapePcm,
};
