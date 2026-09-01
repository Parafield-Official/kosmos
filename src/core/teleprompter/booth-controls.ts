export type BoothShortcutAction = "continue" | "restart" | "mark" | "toggle-pause";

/**
 * Map function keys emitted by a keyboard or programmable foot pedal to booth
 * actions. Repeats and editable controls are ignored so one held pedal cannot
 * create several punches and reading settings remain safe to type in.
 */
export function boothShortcutAction(input: {
  key: string;
  recording: boolean;
  paused: boolean;
  halted: boolean;
  repeat?: boolean;
  editing?: boolean;
}): BoothShortcutAction | null {
  if (!input.recording || input.repeat || input.editing) {
    return null;
  }
  if (input.key === "F7") {
    return input.halted ? "continue" : null;
  }
  if (input.key === "F10") {
    return "toggle-pause";
  }
  if (input.paused) {
    return null;
  }
  if (input.key === "F8") {
    return "restart";
  }
  if (input.key === "F9") {
    return "mark";
  }
  return null;
}
