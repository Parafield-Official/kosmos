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
  if (narrationSeat !== "N1" && narrationSeat !== "N2") {
    throw new Error("Duet narration seat must be N1 or N2");
  }
  if (input.crossfadeMs !== undefined && (!Number.isFinite(input.crossfadeMs) || input.crossfadeMs < 0)) {
    throw new Error("Duet crossfade must be a finite non-negative number");
  }
  if (!Array.isArray(input.segments)) {
    throw new Error("Duet segments must be an array");
  }
  const crossfadeSamples = Math.max(0, Math.round((input.crossfadeMs ?? 20) * input.sampleRate / 1000));
  const mask = new Uint8Array(input.n1.length);
  const sorted = input.segments
    .map((segment) => {
      if (!segment || typeof segment !== "object") {
        throw new Error("Duet segment must be an object");
      }
      if (segment.seat !== "narration" && segment.seat !== "N1" && segment.seat !== "N2") {
        throw new Error(`Unknown duet seat: ${String(segment.seat)}`);
      }
      if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start) {
        throw new Error("Duet segment timing must be finite and end after a non-negative start");
      }
      return segment;
    })
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
    // An unpainted gap is the N1 bed in the canonical mix, so it also belongs
    // in the N1 stem. This keeps exported stems able to reconstruct the mix.
    n1Stem[index] = mask[index] === 2 ? 0 : input.n1[index];
    n2Stem[index] = mask[index] === 2 ? input.n2[index] : 0;
  }
  if (crossfadeSamples > 0) {
    for (let index = 1; index < mask.length; index += 1) {
      // A zero mask is the N1 bed in the mixed output. Treat it as N1 for
      // seam detection too, otherwise every N1→N2 or N2→bed transition is a
      // hard sample discontinuity despite the requested crossfade.
      const previousSeat = mask[index - 1] === 2 ? 2 : 1;
      const currentSeat = mask[index] === 2 ? 2 : 1;
      if (currentSeat === previousSeat) {
        continue;
      }
      const half = Math.max(1, Math.floor(crossfadeSamples / 2));
      const start = Math.max(0, index - half);
      const end = Math.min(mask.length - 1, index + half);
      const span = Math.max(1, end - start);
      const from = previousSeat === 2 ? input.n2 : input.n1;
      const to = currentSeat === 2 ? input.n2 : input.n1;
      for (let cursor = start; cursor <= end; cursor += 1) {
        const amount = (cursor - start) / span;
        if (previousSeat === 1) {
          n1Stem[cursor] = input.n1[cursor] * (1 - amount);
          n2Stem[cursor] = input.n2[cursor] * amount;
        } else {
          n2Stem[cursor] = input.n2[cursor] * (1 - amount);
          n1Stem[cursor] = input.n1[cursor] * amount;
        }
        mix[cursor] = n1Stem[cursor] + n2Stem[cursor];
      }
    }
  }
  return {
    mix,
    n1Stem,
    n2Stem,
  };
}
