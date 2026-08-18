import type { Pickup } from "../project/types";

export interface MarkerFile {
  fileName: string;
  contents: string;
}

export interface MarkerOptions {
  includeIgnored?: boolean;
  maxLabelLength?: number;
}

export function audacityLabels(pickups: Pickup[], options: MarkerOptions = {}): string {
  return eligiblePickups(pickups, options)
    .map((pickup) => `${formatSeconds(pickup.t_start)}\t${formatSeconds(pickup.t_end)}\t${markerLabel(pickup, options)}\n`)
    .join("");
}

/** Reaper accepts tab-delimited marker rows; the first column is a stable index. */
export function reaperMarkers(pickups: Pickup[], options: MarkerOptions = {}): string {
  const rows = eligiblePickups(pickups, options).map((pickup, index) =>
    `${index + 1}\t${markerLabel(pickup, options)}\t${formatSeconds(pickup.t_start)}\t${formatSeconds(pickup.t_end)}`,
  );
  return ["#\tName\tStart\tEnd", ...rows, ""].join("\n");
}

export function markerFileSet(
  baseName: string,
  pickups: Pickup[],
  options: MarkerOptions = {},
): MarkerFile[] {
  const safeBase = baseName.replace(/[^a-z0-9_-]+/giu, "_");
  return [
    {
      fileName: `${safeBase}_audacity_labels.txt`,
      contents: audacityLabels(pickups, options),
    },
    {
      fileName: `${safeBase}_reaper_markers.tsv`,
      contents: reaperMarkers(pickups, options),
    },
    {
      fileName: `${safeBase}_MARKERS_README.txt`,
      contents: [
        "Kosmos marker export",
        "",
        "Audacity: File → Import → Labels, then choose the *_audacity_labels.txt file.",
        "Reaper: import the tab-delimited *_reaper_markers.tsv file or copy its rows into the marker list.",
        "",
        "Markers identify word mismatches and configured long pauses only. Listen for acting, clicks, echo, and noise.",
        "",
      ].join("\n"),
    },
  ];
}

function eligiblePickups(pickups: Pickup[], options: MarkerOptions): Pickup[] {
  return pickups
    .filter((pickup) => options.includeIgnored || pickup.status !== "ignored")
    .filter((pickup) => Number.isFinite(pickup.t_start) && Number.isFinite(pickup.t_end))
    .sort((left, right) => left.t_start - right.t_start || left.id.localeCompare(right.id));
}

function markerLabel(pickup: Pickup, options: MarkerOptions): string {
  const expected = pickup.expected || "—";
  const heard = pickup.heard || "—";
  const full = `${expected} → ${heard} [${pickup.kind}]`;
  const maxLength = options.maxLabelLength ?? 96;
  return full.length > maxLength ? `${full.slice(0, Math.max(1, maxLength - 1))}…` : full;
}

function formatSeconds(value: number): string {
  return Math.max(0, value).toFixed(3);
}
