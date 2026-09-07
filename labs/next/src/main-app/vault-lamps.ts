import { LAMP_ALL } from "./vault-light-layout";

export const VAULT_LAMPS_KEY = "kosmos-vault-lamps";
export const VAULT_LAMPS_EVENT = "kosmos-vault-lamps-changed";

export { LAMP_ALL };

/** Gallery lighting is one preset: every lamp, or one focused lamp. */
export function normalizeLampSelection(value: number): number {
  const masked = value & LAMP_ALL;
  if (masked === 0 || masked === LAMP_ALL) {
    return LAMP_ALL;
  }
  if ((masked & (masked - 1)) === 0) {
    return masked;
  }
  return masked & -masked;
}

export function readLamps(): number {
  try {
    const raw = window.sessionStorage.getItem(VAULT_LAMPS_KEY);
    if (raw == null) return LAMP_ALL;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= LAMP_ALL) return normalizeLampSelection(value);
  } catch {
    // Session memory is optional.
  }
  return LAMP_ALL;
}

export function writeLamps(value: number): number {
  const next = normalizeLampSelection(value);
  try {
    window.sessionStorage.setItem(VAULT_LAMPS_KEY, String(next));
  } catch {
    // Session memory is optional.
  }
  window.dispatchEvent(new Event(VAULT_LAMPS_EVENT));
  return next;
}
