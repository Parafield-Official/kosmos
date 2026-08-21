import rawSpec from "../../../acx_spec.json";

export interface AcxSpec {
  version: string;
  rms_dbfs: { min: number; max: number; target: number };
  true_peak_dbfs_max: number;
  true_peak_limiter_ceiling: number;
  noise_floor_dbfs_max: number;
  sample_rate: number;
  min_bitrate_cbr: number;
  vbr_allowed: boolean;
  channels: "all_mono_or_all_stereo";
  max_file_seconds: number;
  room_tone_head_s: { min: number; max: number; target: number };
  room_tone_tail_s: { min: number; max: number; target: number };
  retail_sample_s: { min: number; max: number };
}

export const ACX_SPEC = rawSpec as AcxSpec;

/** "unspecified" is a dimension the chosen delivery target sets no limit for. */
export type CheckStatus = "pass" | "warn" | "fail" | "unspecified";
export type TrafficLight = "green" | "yellow" | "red";

export function trafficLight(checks: Record<string, CheckStatus>): TrafficLight {
  const statuses = Object.values(checks).filter((status) => status !== "unspecified");
  if (statuses.includes("fail")) {
    return "red";
  }
  if (statuses.includes("warn")) {
    return "yellow";
  }
  return "green";
}
