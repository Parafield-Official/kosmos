import type { PickupKind } from "../project/types";

export type PickupKindTone = "danger" | "warning" | "info";

export interface PickupKindPresentation {
  label: string;
  tone: PickupKindTone;
}

const PRESENTATION: Record<PickupKind, PickupKindPresentation> = {
  sub: { label: "misread", tone: "danger" },
  skip: { label: "missing", tone: "warning" },
  insert: { label: "added", tone: "warning" },
  pause: { label: "long pause", tone: "info" },
};

/** Narrator-facing name and severity for each manuscript difference. */
export function pickupKindPresentation(kind: PickupKind): PickupKindPresentation {
  return PRESENTATION[kind];
}
