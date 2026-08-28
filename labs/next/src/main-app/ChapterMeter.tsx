import { useState } from "react";
import type { AcxReport } from "../../../../src/core/acx/measure";
import { noiseFloorListenRange } from "../../../../src/core/acx/measure";
import {
  formatChannels,
  formatDb,
  formatLength,
  formatLufs,
  formatRoomTone,
  formatSampleRate,
} from "../../../../src/core/acx/format";
import { checkDefinition, exportSettles, type CheckKey } from "../../../../src/core/acx/fixes";
import { deliveryProfile, presetTargets, resolvePreset } from "../../../../src/core/acx/presets";
import type { CheckStatus } from "../../../../src/core/acx/spec";

const ROW_ORDER: Array<{ id: string; key: CheckKey; label: string; measured: (report: AcxReport) => string }> = [
  { id: "rms", key: "rms", label: "Loudness (RMS)", measured: (report) => formatDb(report.rms_dbfs) },
  { id: "loudness", key: "loudness", label: "Loudness (LUFS)", measured: (report) => formatLufs(report.lufs_integrated) },
  { id: "true_peak", key: "true_peak", label: "True peak", measured: (report) => formatDb(report.true_peak_dbfs) },
  { id: "noise_floor", key: "noise_floor", label: "Noise floor", measured: (report) => formatDb(report.noise_floor_dbfs) },
  { id: "duration", key: "duration", label: "Length", measured: (report) => formatLength(report.duration_seconds) },
  { id: "head_room_tone", key: "head_room_tone", label: "Head room tone", measured: (report) => formatRoomTone(report.head_room_tone_s) },
  { id: "tail_room_tone", key: "tail_room_tone", label: "Tail room tone", measured: (report) => formatRoomTone(report.tail_room_tone_s) },
  { id: "sample_rate", key: "sample_rate", label: "Sample rate", measured: (report) => formatSampleRate(report.sample_rate) },
  { id: "channels", key: "channels", label: "Channels", measured: (report) => formatChannels(report.channels) },
];

function statusLabel(status: CheckStatus | AcxReport["traffic_light"]): string {
  if (status === "green" || status === "pass") return "Ready";
  if (status === "yellow" || status === "warn") return "Close";
  if (status === "red" || status === "fail") return "Needs a fix";
  return "Not judged";
}

/**
 * Compact ACX traffic light for a chapter working file. Mastering-plan mode
 * treats loudness/rate rows as export's job so a raw take is not a false fail.
 */
export function ChapterMeter({
  report,
  masteringPlan,
  onListenQuiet,
}: {
  report: AcxReport;
  masteringPlan?: boolean;
  onListenQuiet?: () => void;
}) {
  const preset = resolvePreset(report.preset_id);
  const profile = deliveryProfile(preset);
  const targets = presetTargets(preset);
  const rows = ROW_ORDER.map((row) => ({
    ...row,
    target: targets[row.key],
    measured: row.measured(report),
    status: report.checks[row.key],
  }));
  const trouble = rows.filter((row) => row.status === "fail" || row.status === "warn");
  const inHand = masteringPlan ? trouble.filter((row) => exportSettles(row.key, profile)) : [];
  const yours = trouble.filter((row) => !inHand.includes(row));
  const light = yours.length === 0 && inHand.length > 0 ? "in-hand" : report.traffic_light;
  const [open, setOpen] = useState(true);

  return (
    <div className={`ma-meter neu-inset ma-meter-${light}`}>
      <div className="ma-meter-verdict">
        <span className={`ma-meter-light ma-meter-light-${light}`}>
          {light === "in-hand" ? "Mastering will settle" : statusLabel(report.traffic_light)}
        </span>
        <p>
          {trouble.length === 0
            ? "This chapter meets every ACX level Audible asks for."
            : yours.length === 0
              ? "Nothing here needs a re-record. Mastering will settle the rest."
              : yours.length === 1
                ? "One thing only you can settle before ACX will take this."
                : `${yours.length} things only you can settle before ACX will take this.`}
        </p>
      </div>
      {yours.length > 0 ? (
        <ul className="ma-meter-trouble">
          {yours.map((row) => (
            <li key={row.id}>
              <strong>{row.label}</strong> is {row.measured}; ACX wants {row.target}.
            </li>
          ))}
        </ul>
      ) : null}
      {inHand.length > 0 ? (
        <ul className="ma-meter-trouble ma-meter-inhand">
          {inHand.map((row) => (
            <li key={row.id}>
              <strong>{row.label}</strong> is {row.measured}. {checkDefinition(row.key, profile).promise}.
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="btn btn-sm btn-clear" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide measurements" : "All measurements"}
      </button>
      {open ? (
        <table className="ma-meter-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Target</th>
              <th>This file</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td>{row.target}</td>
                <td>{row.measured}</td>
                <td>{inHand.includes(row) ? "Mastering handles" : statusLabel(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {onListenQuiet ? (
        <button type="button" className="btn btn-sm" onClick={onListenQuiet}>
          Listen to the quietest bit
        </button>
      ) : null}
    </div>
  );
}

export function quietListenRange(report: AcxReport): { start: number; end: number } {
  return noiseFloorListenRange(
    report.noise_floor_start_seconds,
    report.noise_floor_duration_seconds,
    report.duration_seconds,
  );
}
