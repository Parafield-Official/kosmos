import { describe, expect, it } from "vitest";
import { masterPcm } from "./master";
import { ACX_PRESET } from "./presets";
import { measurePcm } from "./measure";
import { decodeWavPcm16, encodeWavPcm16 } from "../audio/wav";

const RATE = 44_100;
const PAD_SECONDS = 1.5;
const HEAD_LIMIT = ACX_PRESET.room_tone_head_s!;
const TAIL_LIMIT = ACX_PRESET.room_tone_tail_s!;
/** MP3 encoder delay and 20 ms meter frames must not push an exported file over the limit. */
const EXPORT_MARGIN_SECONDS = 0.4;

type Edge = "dither" | "room" | "zero";

/**
 * Three phrases separated by pauses, framed by a recorded lead-in and tail.
 * "dither" is ±1.5 PCM16 steps (about -91.5 dBFS), the near-silence an MP3 from
 * a voice generator decodes to; "room" is a quiet microphone room at -72 dBFS.
 */
function take(leadIn: number, tail: number, edge: Edge): Float32Array {
  let seed = 0x5eed;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return (seed / 0x1_0000_0000) * 2 - 1;
  };
  const quiet = () => edge === "zero"
    ? 0
    : edge === "dither" ? random() * 1.5 / 32_768 : random() * Math.sqrt(3) * 10 ** (-72 / 20);
  const phrase = 1.0;
  const pause = 0.4;
  const length = Math.round((leadIn + 3 * phrase + 2 * pause + tail) * RATE);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / RATE - leadIn;
    const inPhrase = t >= 0 && t < 3 * phrase + 2 * pause && t % (phrase + pause) < phrase;
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
    const voice = 0.12 * syllable * (Math.sin(2 * Math.PI * 160 * t) + 0.5 * Math.sin(2 * Math.PI * 320 * t) + 0.25 * Math.sin(2 * Math.PI * 640 * t));
    output[i] = (inPhrase ? voice : 0) + quiet();
  }
  return output;
}

function firstLoudSeconds(samples: Float32Array): number {
  const frame = Math.round(RATE * 0.02);
  for (let start = 0; start < samples.length; start += frame) {
    let sum = 0;
    const end = Math.min(samples.length, start + frame);
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
    if (10 * Math.log10(sum / (end - start)) > -40) return start / RATE;
  }
  return Infinity;
}

function expectDeliverable(samples: Float32Array) {
  // The app writes the master as PCM16 WAV; judge what is actually written.
  const delivered = measurePcm({ ...decodeWavPcm16(encodeWavPcm16(samples, RATE, 1)), format: "wav" });
  expect(delivered.checks.rms).toBe("pass");
  expect(delivered.checks.head_room_tone, `head ${delivered.head_room_tone_s.toFixed(2)} s`).toBe("pass");
  expect(delivered.checks.tail_room_tone, `tail ${delivered.tail_room_tone_s.toFixed(2)} s`).toBe("pass");
  expect(delivered.head_room_tone_s).toBeLessThanOrEqual(HEAD_LIMIT.max - EXPORT_MARGIN_SECONDS);
  expect(delivered.tail_room_tone_s).toBeLessThanOrEqual(TAIL_LIMIT.max - EXPORT_MARGIN_SECONDS);
}

describe("ACX room-tone boundaries", () => {
  it("masters a voice-generator take with a 4.2-second near-silent lead-in (customer regression)", () => {
    // ElevenLabs Chapter 6: 4.18 s of ±1-step dither before the first breath,
    // speech to 0.16 s from the end. The shipped master kept the lead-in and
    // still prepended a 1.5 s pad, so the head measured 5.68 s and failed.
    const source = take(4.18, 0.16, "dither");
    const result = masterPcm({ samples: source, sampleRate: RATE, channels: 1 });

    expect(result.status, result.abort_reason).toBe("ok");
    expect(result.after?.checks.head_room_tone).toBe("pass");
    expect(result.after?.checks.tail_room_tone).toBe("pass");
    expectDeliverable(result.samples);
    // Only far-edge lead-in is removed: the 3 s nearest the first breath stay.
    expect(firstLoudSeconds(result.samples) - PAD_SECONDS).toBeGreaterThanOrEqual(3 - 0.03);
  }, 120_000);

  it("never mistakes quiet, unbroken narration for removable room tone", () => {
    // One loud click and almost no pauses make the meter's adaptive noise
    // floor call a steady -41 dBFS voice "room tone", and the gate then lowers
    // it. Trimming must not trust either: only audio far below the take's own
    // pre-gate speech level can go. A first fix deleted 60 s of this take.
    const seconds = 68;
    const source = new Float32Array(RATE * seconds);
    for (let i = 0; i < source.length; i += 1) {
      const t = i / RATE;
      source[i] = 0.00003 * Math.sin(2 * Math.PI * 3100 * t);
      if (t >= 1 && t < seconds - 1) source[i] += 0.012 * Math.sin(2 * Math.PI * 220 * t);
      if (t >= 3 && t < 3.004) source[i] += 0.5 * Math.sin(Math.PI * (t - 3) / 0.004) ** 2 * Math.sin(2 * Math.PI * 1000 * t);
    }
    const result = masterPcm({ samples: source, sampleRate: RATE, channels: 1 });

    expect(result.status, result.abort_reason).toBe("ok");
    expect(result.samples.length).toBeGreaterThanOrEqual(source.length + 2 * PAD_SECONDS * RATE - 2);
  }, 120_000);

  const geometries: Array<[number, number]> = [
    [0, 0], [0.16, 0.16], [1, 1], [3, 3], [3.4, 3.4], [4.18, 0.16], [5, 5], [8, 8], [15, 12],
  ];
  describe.each<Edge>(["dither", "room", "zero"])("with %s edges", (edge) => {
    it.each(geometries)("lead-in %s s and tail %s s stay inside the limit without losing speech", (leadIn, tail) => {
      const source = take(leadIn, tail, edge);
      const result = masterPcm({ samples: source, sampleRate: RATE, channels: 1 });

      expect(result.status, result.abort_reason).toBe("ok");
      expectDeliverable(result.samples);
      // Room tone added by Kosmos is never trimmed away.
      expect(result.after!.head_room_tone_s).toBeGreaterThanOrEqual(PAD_SECONDS - 0.02);
      expect(result.after!.tail_room_tone_s).toBeGreaterThanOrEqual(PAD_SECONDS - 0.02);
      // A recorded lead-in survives whole unless it alone would break the
      // limit; then only its far edge goes. Exact zeros are editing silence.
      const keptLeadIn = firstLoudSeconds(result.samples) - PAD_SECONDS;
      const expectedLeadIn = edge === "zero" ? 0 : Math.min(leadIn, HEAD_LIMIT.max - 0.5 - PAD_SECONDS);
      expect(keptLeadIn).toBeGreaterThanOrEqual(expectedLeadIn - 0.03);
      expect(keptLeadIn).toBeLessThanOrEqual(expectedLeadIn + 0.03);
      // Nothing between the first and last phrase is removed.
      const speechSeconds = 3 + 2 * 0.4;
      const bodyEnd = result.samples.length / RATE - result.after!.tail_room_tone_s;
      expect(bodyEnd - firstLoudSeconds(result.samples)).toBeGreaterThanOrEqual(speechSeconds - 0.25);
    }, 120_000);
  });
});
