import type { Seat } from "../project/types";

export interface DuetSegment {
  start: number;
  end: number;
  seat: Seat;
}

export interface DuetMixInput {
  n1: Float32Array;
  n2: Float32Array;
  sampleRate: number;
  segments: DuetSegment[];
  narrationSeat?: "N1" | "N2";
  crossfadeMs?: number;
}

export interface DuetMixResult {
  mix: Float32Array;
  n1Stem: Float32Array;
  n2Stem: Float32Array;
}

/**
 * Mix two already-aligned mono seats by script timeline. This is intentionally
 * a small, deterministic offline mixer: no live remote audio and no TTS.
 */
export function mixDuetTracks(input: DuetMixInput): DuetMixResult {
  if (!Number.isInteger(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error("Duet sample rate must be a positive integer");
  }
  if (input.n1.length !== input.n2.length) {
    throw new Error("Duet seat tracks must have the same length");
  }
  const narrationSeat = input.narrationSeat ?? "N1";
  const crossfadeSamples = Math.max(0, Math.round((input.crossfadeMs ?? 20) * input.sampleRate / 1000));
  const mask = new Uint8Array(input.n1.length);
  const sorted = [...input.segments]
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .sort((left, right) => left.start - right.start);
  for (const segment of sorted) {
    const start = Math.max(0, Math.floor(segment.start * input.sampleRate));
    const end = Math.min(mask.length, Math.ceil(segment.end * input.sampleRate));
    const seat = segment.seat === "narration" ? narrationSeat : segment.seat;
    const value = seat === "N2" ? 2 : 1;
    for (let index = start; index < end; index += 1) {
      mask[index] = value;
    }
  }
  // A gap carries the bed's room tone when available; an explicit segment wins
  // over earlier overlap. Stems remain seat-masked below.
  const mix = new Float32Array(input.n1.length);
  const n1Stem = new Float32Array(input.n1.length);
  const n2Stem = new Float32Array(input.n2.length);
  for (let index = 0; index < mix.length; index += 1) {
    mix[index] = mask[index] === 2 ? input.n2[index] : input.n1[index];
    n1Stem[index] = mask[index] === 1 ? input.n1[index] : 0;
    n2Stem[index] = mask[index] === 2 ? input.n2[index] : 0;
  }
  if (crossfadeSamples > 0) {
    for (let index = 1; index < mask.length; index += 1) {
      if (mask[index] === mask[index - 1] || mask[index] === 0 || mask[index - 1] === 0) {
        continue;
      }
      const half = Math.max(1, Math.floor(crossfadeSamples / 2));
      const start = Math.max(0, index - half);
      const end = Math.min(mask.length - 1, index + half);
      const span = Math.max(1, end - start);
      const from = mask[index - 1] === 2 ? input.n2 : input.n1;
      const to = mask[index] === 2 ? input.n2 : input.n1;
      for (let cursor = start; cursor <= end; cursor += 1) {
        const amount = (cursor - start) / span;
        mix[cursor] = from[cursor] * (1 - amount) + to[cursor] * amount;
      }
    }
  }
  return {
    mix,
    n1Stem,
    n2Stem,
  };
}
