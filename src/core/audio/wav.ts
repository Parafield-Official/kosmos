export interface DecodedWav {
  sampleRate: number;
  channels: number;
  samples: Float32Array;
}

/** Encode interleaved float samples as little-endian PCM16 WAV. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number, channels: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0) {
    throw new Error("WAV sample rate and channels must be positive integers");
  }
  if (samples.length % channels !== 0) {
    throw new Error("Interleaved sample count must be divisible by channels");
  }
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    const pcm = clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
    view.setInt16(44 + index * 2, pcm, true);
  });
  return bytes;
}

export function decodeWavPcm16(bytes: Uint8Array): DecodedWav {
  if (bytes.length < 44 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const content = offset + 8;
    if (id === "fmt ") {
      audioFormat = view.getUint16(content, true);
      channels = view.getUint16(content + 2, true);
      sampleRate = view.getUint32(content + 4, true);
      bitsPerSample = view.getUint16(content + 14, true);
    } else if (id === "data") {
      dataOffset = content;
      dataLength = Math.min(length, bytes.length - content);
      break;
    }
    offset = content + length + (length % 2);
  }
  if (audioFormat !== 1 || bitsPerSample !== 16 || channels <= 0 || sampleRate <= 0 || dataOffset < 0) {
    throw new Error("Only 16-bit PCM WAV files are supported");
  }
  const count = Math.floor(dataLength / 2);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32_768;
  }
  return { sampleRate, channels, samples };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
