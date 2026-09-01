/**
 * One spelling for every measured value.
 *
 * The same level is shown in the meter table, in the list of what mastering
 * fixed, and in the exported report. A number that reads "-20.0" in one place
 * and "−20.0 dBFS" in another is a number the reader has to reconcile by hand,
 * so the formatting lives here rather than beside each view.
 */

const MINUS = "−";

/** A typographic minus, so a column of levels lines up under its target text. */
export function fixedNumber(value: number, digits = 1): string {
  if (Number.isNaN(value)) {
    return "—";
  }
  if (value === -Infinity) {
    return `${MINUS}∞`;
  }
  if (value === Infinity) {
    return "∞";
  }
  return value.toFixed(digits).replace("-", MINUS);
}

export function formatDb(value: number): string {
  return `${fixedNumber(value)} dBFS`;
}

export function formatLufs(value: number): string {
  return `${fixedNumber(value)} LUFS`;
}

export function formatSampleRate(value: number): string {
  return `${(value / 1000).toFixed(1)} kHz`;
}

/** Words, because the channel target reads "Mono or stereo", not "1 or 2". */
export function formatChannels(count: number): string {
  if (count === 1) {
    return "Mono";
  }
  if (count === 2) {
    return "Stereo";
  }
  return `${count} channels`;
}

/** Room tone is judged in tenths of a second, so it is shown to hundredths. */
export function formatRoomTone(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) {
    return `${hours} hr ${String(minutes).padStart(2, "0")} min`;
  }
  return minutes > 0 ? `${minutes} min ${String(rest).padStart(2, "0")} s` : `${rest} s`;
}
