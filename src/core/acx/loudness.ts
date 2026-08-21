/**
 * Integrated loudness per ITU-R BS.1770-4: K-weight each channel, take the mean
 * square of overlapping 400 ms blocks, then discard quiet blocks with the
 * absolute and relative gates before averaging what is left.
 *
 * ACX states its loudness target in dBFS RMS, not LUFS, so this is not an ACX
 * pass/fail input. It is here because other distributors publish LUFS windows
 * and because a narrator comparing our numbers to a broadcast meter should see
 * the same figure.
 *
 * The filter coefficients are derived from the analog prototype at the file's
 * own sample rate rather than copied from the standard's 48 kHz table, so a
 * 44.1 kHz chapter measures correctly. `loudness.test.ts` checks the result
 * against the EBU Tech 3341 compliance signals at both rates.
 */

const BLOCK_SECONDS = 0.4;
const BLOCK_STEP_SECONDS = 0.1;
/** BS.1770 calibration offset, applied to every loudness figure. */
const OFFSET_DB = -0.691;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

/** Stage 1 of the K-weighting: the head-shadow high shelf. */
const SHELF = { fc: 1681.974450955533, gainDb: 3.999843853973347, q: 0.7071752369554196 };
/** Stage 2 of the K-weighting: the RLB high pass. */
const HIGH_PASS = { fc: 38.13547087602444, q: 0.5003270373238773 };
/** Relates the shelf's mid-band gain to its high-frequency gain. */
const SHELF_BANDWIDTH_EXPONENT = 0.4996667741545416;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Integrated loudness in LUFS, or -Infinity when the file is silent or shorter
 * than one 400 ms gating block.
 */
export function integratedLufs(
  samples: Float32Array | number[],
  sampleRate: number,
  channels: number,
): number {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    return -Infinity;
  }
  const channelCount = Number.isInteger(channels) && channels > 0 ? channels : 1;
  const frameCount = Math.floor(samples.length / channelCount);
  const blockFrames = Math.round(BLOCK_SECONDS * sampleRate);
  const stepFrames = Math.round(BLOCK_STEP_SECONDS * sampleRate);
  if (frameCount < blockFrames || blockFrames <= 0 || stepFrames <= 0) {
    return -Infinity;
  }

  const shelf = highShelf(SHELF.fc, SHELF.q, SHELF.gainDb, sampleRate);
  const highPass = highPassFilter(HIGH_PASS.fc, HIGH_PASS.q, sampleRate);

  // Sum of the weighted mean squares of every channel, per block. Channel
  // weights are 1.0 for mono and stereo, so the sum needs no per-channel term.
  const blockCount = Math.floor((frameCount - blockFrames) / stepFrames) + 1;
  const blockPower = new Float64Array(blockCount);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const weighted = kWeightChannel(samples, frameCount, channelCount, channel, shelf, highPass);
    // A running sum of squares keeps a feature-length chapter linear rather
    // than quadratic in the 75% block overlap.
    const cumulative = new Float64Array(frameCount + 1);
    for (let index = 0; index < frameCount; index += 1) {
      cumulative[index + 1] = cumulative[index] + weighted[index] * weighted[index];
    }
    for (let block = 0; block < blockCount; block += 1) {
      const start = block * stepFrames;
      const sum = cumulative[start + blockFrames] - cumulative[start];
      blockPower[block] += sum / blockFrames;
    }
  }

  const aboveAbsolute: number[] = [];
  for (let block = 0; block < blockCount; block += 1) {
    if (blockLoudness(blockPower[block]) > ABSOLUTE_GATE_LUFS) {
      aboveAbsolute.push(blockPower[block]);
    }
  }
  if (aboveAbsolute.length === 0) {
    return -Infinity;
  }

  const relativeGate = blockLoudness(mean(aboveAbsolute)) + RELATIVE_GATE_LU;
  const retained = aboveAbsolute.filter((power) => blockLoudness(power) > relativeGate);
  if (retained.length === 0) {
    return -Infinity;
  }
  return blockLoudness(mean(retained));
}

function blockLoudness(power: number): number {
  return power <= 0 ? -Infinity : OFFSET_DB + 10 * Math.log10(power);
}

function mean(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

function kWeightChannel(
  samples: Float32Array | number[],
  frameCount: number,
  stride: number,
  channel: number,
  shelf: Biquad,
  highPass: Biquad,
): Float64Array {
  const out = new Float64Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    const value = samples[index * stride + channel];
    out[index] = Number.isFinite(value) ? value : 0;
  }
  applyBiquad(out, shelf);
  applyBiquad(out, highPass);
  return out;
}

function applyBiquad(signal: Float64Array, filter: Biquad): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < signal.length; index += 1) {
    const x0 = signal[index];
    const y0 = filter.b0 * x0 + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
    signal[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

/**
 * Both stages come from the analog prototype through a bilinear transform with
 * a tangent prewarp. At 48 kHz this reproduces the coefficient table printed in
 * BS.1770 to thirteen significant figures, which is what makes it safe to use
 * the same derivation at 44.1 kHz where the standard prints no table.
 */
function highShelf(fc: number, q: number, gainDb: number, sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * fc) / sampleRate);
  const highGain = Math.pow(10, gainDb / 20);
  const bandGain = Math.pow(highGain, SHELF_BANDWIDTH_EXPONENT);
  const a0 = 1 + k / q + k * k;
  return {
    b0: (highGain + (bandGain * k) / q + k * k) / a0,
    b1: (2 * (k * k - highGain)) / a0,
    b2: (highGain - (bandGain * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

function highPassFilter(fc: number, q: number, sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * fc) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}
