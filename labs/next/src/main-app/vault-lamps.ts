import { LAMP_ALL } from "./vault-light-layout";

export const VAULT_LAMPS_KEY = "kosmos-vault-lamps";
export const VAULT_LAMPS_EVENT = "kosmos-vault-lamps-changed";

export { LAMP_ALL };

export function readLamps(): number {
  try {
    const raw = window.sessionStorage.getItem(VAULT_LAMPS_KEY);
    if (raw == null) return LAMP_ALL;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= LAMP_ALL) return value;
  } catch {
    // Session memory is optional.
  }
  return LAMP_ALL;
}

export function writeLamps(value: number): number {
  const next = value & LAMP_ALL;
  try {
    window.sessionStorage.setItem(VAULT_LAMPS_KEY, String(next));
  } catch {
    // Session memory is optional.
  }
  window.dispatchEvent(new Event(VAULT_LAMPS_EVENT));
  return next;
}
