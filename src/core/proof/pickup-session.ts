import type { Pickup } from "../project/types";

export interface PickupSessionItem {
  pickup: Pickup;
  /** Several proof flags can belong to the one sentence being rerecorded. */
  pickupIds: string[];
}

export interface PickupSession {
  items: PickupSessionItem[];
  totalFlags: number;
  completedTasks: number;
  completedFlags: number;
  supersededFlags: string[];
}

export interface AppliedPickupResult {
  pickupIds: string[];
  start: number;
  end: number;
  durationDelta: number;
}

function recordingBounds(pickup: Pickup): { start: number; end: number } {
  if (
    Number.isFinite(pickup.line_start)
    && Number.isFinite(pickup.line_end)
    && (pickup.line_end as number) > (pickup.line_start as number)
  ) {
    return { start: Math.max(0, pickup.line_start as number), end: pickup.line_end as number };
  }
  return { start: Math.max(0, pickup.t_start), end: Math.max(0, pickup.t_end) };
}

function lineKey(pickup: Pickup): string {
  const bounds = recordingBounds(pickup);
  // Alignment timestamps can contain decoder-scale floating point noise. A
  // millisecond key groups flags that point at the same recorded sentence.
  return `${pickup.chapter_id}:${bounds.start.toFixed(3)}:${bounds.end.toFixed(3)}`;
}

export function buildPickupSession(pickups: readonly Pickup[]): PickupSession {
  const open = pickups
    .filter((pickup) => pickup.status === "open")
    .sort((left, right) => recordingBounds(left).start - recordingBounds(right).start);
  const grouped = new Map<string, PickupSessionItem>();
  for (const pickup of open) {
    const key = lineKey(pickup);
    const existing = grouped.get(key);
    if (existing) {
      existing.pickupIds.push(pickup.id);
    } else {
      grouped.set(key, { pickup: { ...pickup }, pickupIds: [pickup.id] });
    }
  }
  return {
    items: [...grouped.values()],
    totalFlags: open.length,
    completedTasks: 0,
    completedFlags: 0,
    supersededFlags: [],
  };
}

function shiftPickup(pickup: Pickup, delta: number): Pickup {
  const shifted = { ...pickup };
  for (const field of ["t_start", "t_end", "line_start", "line_end"] as const) {
    const value = shifted[field];
    if (Number.isFinite(value)) {
      shifted[field] = (value as number) + delta;
    }
  }
  return shifted;
}

export function advancePickupSession(
  session: PickupSession,
  applied: AppliedPickupResult,
): PickupSession {
  const completedIds = new Set(applied.pickupIds);
  const superseded: string[] = [];
  const items: PickupSessionItem[] = [];
  for (const item of session.items) {
    if (item.pickupIds.some((id) => completedIds.has(id))) {
      continue;
    }
    const bounds = recordingBounds(item.pickup);
    if (bounds.start < applied.end && bounds.end > applied.start) {
      superseded.push(...item.pickupIds);
      continue;
    }
    items.push({
      ...item,
      pickup: bounds.start >= applied.end && applied.durationDelta !== 0
        ? shiftPickup(item.pickup, applied.durationDelta)
        : item.pickup,
    });
  }

  return {
    ...session,
    items,
    completedTasks: session.completedTasks + 1,
    completedFlags: session.completedFlags + applied.pickupIds.length,
    supersededFlags: [...session.supersededFlags, ...superseded],
  };
}
