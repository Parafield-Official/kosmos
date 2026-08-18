import type { PunchRecording } from "../project/types";

export interface PickupComparison {
  id: string;
  pickupId?: string;
  originalPath: string;
  replacementPath: string;
  editedPath?: string;
  start: number;
  end: number;
  expected?: string;
  heard?: string;
  createdAt: string;
}

export interface PickupComparisonInput {
  rawAudioPath?: string;
  currentAudioPath?: string;
  punches: PunchRecording[];
}

/** Build safe A/B pairs while preserving the untouched source as side A. */
export function buildPickupComparisons(input: PickupComparisonInput): PickupComparison[] {
  const originalPath = input.rawAudioPath || input.currentAudioPath;
  if (!originalPath) {
    return [];
  }
  return input.punches
    .filter((punch) =>
      typeof punch.path === "string"
      && punch.path.length > 0
      && Number.isFinite(punch.t_start)
      && Number.isFinite(punch.t_end)
      && (punch.t_start ?? -1) >= 0
      && (punch.t_end ?? 0) > (punch.t_start ?? 0),
    )
    .map((punch) => ({
      id: punch.id,
      ...(punch.pickup_id ? { pickupId: punch.pickup_id } : {}),
      originalPath,
      replacementPath: punch.path,
      ...(punch.edited_path ? { editedPath: punch.edited_path } : {}),
      start: punch.t_start as number,
      end: punch.t_end as number,
      ...(punch.expected ? { expected: punch.expected } : {}),
      ...(punch.heard ? { heard: punch.heard } : {}),
      createdAt: punch.created_at,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
