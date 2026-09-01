/** Normalize ffprobe numbers without allowing NaN/Infinity into the meter. */
function finitePositive(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Prefer the decoded codec over a user-controlled filename extension. */
function normalizeAudioFormat(extension, codecName, formatName) {
  const extensionValue = String(extension ?? "")
    .replace(/^\./u, "")
    .toLocaleLowerCase("en-US");
  const codec = String(codecName ?? "").toLocaleLowerCase("en-US");
  const container = String(formatName ?? "").toLocaleLowerCase("en-US");
  if (codec === "mp3" || codec === "mp2" || codec === "mp1") {
    return "mp3";
  }
  if (codec === "flac") {
    return "flac";
  }
  if (codec === "aac" || codec === "alac" || codec === "ac-3" || codec === "eac3" || codec === "mp4a") {
    return "m4a";
  }
  if (container.includes("aiff") || container.includes("aif")) {
    return "aiff";
  }
  if (container.includes("wav") || codec.startsWith("pcm_")) {
    return "wav";
  }
  return {
    wav: "wav",
    wave: "wav",
    mp3: "mp3",
    flac: "flac",
    m4a: "m4a",
    mp4: "m4a",
    aif: "aiff",
    aiff: "aiff",
  }[extensionValue] ?? "unknown";
}

/**
 * Infer MP3 VBR from a bounded packet sample. CBR Layer III frames can differ
 * by one byte because of padding; wider size variation indicates VBR. A
 * non-standard average bitrate is also treated as VBR so an unknown file
 * never receives a false green CBR light.
 */
function inferMp3Vbr(packetSizes, bitrateKbps) {
  const sizes = Array.isArray(packetSizes)
    ? packetSizes.map((value) => finitePositive(value)).filter((value) => value > 0)
    : [];
  if (sizes.length >= 3) {
    const sorted = [...sizes].sort((left, right) => left - right);
    const low = sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0];
    const high = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? sorted.at(-1);
    if (high - low > 1) {
      return true;
    }
  }

  const bitrate = finitePositive(bitrateKbps);
  if (bitrate === 0) {
    return undefined;
  }
  const standardRates = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const nearest = Math.min(...standardRates.map((rate) => Math.abs(rate - bitrate)));
  return nearest > Math.max(1, bitrate * 0.01);
}

function audioDurationFromPcm(byteLength, channels, sampleRate) {
  const bytes = finitePositive(byteLength);
  const channelCount = finitePositive(channels);
  const rate = finitePositive(sampleRate);
  if (bytes === 0 || channelCount === 0 || rate === 0) {
    return 0;
  }
  return bytes / 4 / channelCount / rate;
}

/**
 * Normalize the fields returned by ffprobe without inventing a mono/44.1 kHz
 * interpretation when a decoder omits metadata. The decode path can resample
 * a supported source, but it must never silently change the source contract.
 */
function normalizeProbeMetadata(stream = {}, format = {}) {
  const channels = Number(stream.channels);
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new Error("Audio metadata has an invalid channel count");
  }

  const sampleRate = Number(stream.sample_rate);
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error("Audio metadata has an invalid sample rate");
  }

  const streamDuration = typeof stream.duration === "string" || typeof stream.duration === "number"
    ? Number(stream.duration)
    : Number.NaN;
  const formatDuration = typeof format.duration === "string" || typeof format.duration === "number"
    ? Number(format.duration)
    : Number.NaN;
  // Some containers expose a zero/placeholder stream duration while the
  // format-level duration is accurate (notably a few VBR/MP4 variants). Only
  // accept a stream value when it is positive; otherwise use the format value
  // before rejecting the file.
  const duration = Number.isFinite(streamDuration) && streamDuration > 0
    ? streamDuration
    : formatDuration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Audio metadata has no positive duration");
  }

  return { channels, sampleRate, duration };
}

module.exports = {
  audioDurationFromPcm,
  finitePositive,
  inferMp3Vbr,
  normalizeAudioFormat,
  normalizeProbeMetadata,
};
