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
  if (status === "green" || status === "pass") return "Pass";
  if (status === "yellow" || status === "warn") return "Review";
  if (status === "red" || status === "fail") return "Needs a fix";
  return "Not judged";
}

function MeasurementIcon({ kind }: { kind: CheckKey }) {
  const paths: Partial<Record<CheckKey, string>> = {
    rms: "M4 9h4l5-4v14l-5-4H4Z M17 8q4 4 0 8 M20 5q7 7 0 14",
    loudness: "M4 15v4 M8 10v9 M12 5v14 M16 8v11 M20 12v7",
    true_peak: "M2 13h5l3-8 4 15 3-7h5 M9 2h5",
    noise_floor: "M4 8v.1 M10 6v.1 M17 9v.1 M21 6v.1 M6 13v.1 M13 12v.1 M19 14v.1 M3 19h18",
    duration: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    head_room_tone: "M3 4v16 M7 12h3l2-4 3 9 3-7 2 2h2",
    tail_room_tone: "M21 4v16 M2 12h3l2-4 3 9 3-7 2 2h2",
    sample_rate: "M3 19h18 M5 15V9 M10 15V5 M15 15V7 M20 15v-4",
    channels: "M3 6h18 M3 18h18 M7 3v6 M16 15v6",
  };
  return (
    <svg className="ma-measurement-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  );
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
    <div className={`ma-meter ma-chapter-meter neu-inset ma-meter-${light}`}>
      <div className="ma-meter-verdict">
        <span className={`ma-meter-light ma-meter-light-${light}`}>
          {light === "in-hand" ? "Mastering can help" : statusLabel(report.traffic_light)}
        </span>
        <p>
          {trouble.length === 0
            ? "The measured technical checks pass. Listen through the chapter before submitting."
            : yours.length === 0
              ? "Mastering can try to bring these measurements into range. Check the result afterward."
              : yours.length === 1
                ? "Review this measurement and listen to the audio before submitting."
                : `Review these ${yours.length} measurements before submitting.`}
        </p>
      </div>
      {yours.length > 0 ? (
        <ul className="ma-meter-trouble">
          {yours.map((row) => (
            <li key={row.id}>
              <strong>{row.label}</strong>{row.key === "noise_floor" && report.noise_floor_note
                ? `: ${report.noise_floor_note}`
                : ` is ${row.measured}; the target is ${row.target}.`}
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
              <th>What</th>
              <th>Target</th>
              <th>Measured</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td data-label="What"><span className="ma-measurement-name"><MeasurementIcon kind={row.key} /><span>{row.label}</span></span></td>
                <td data-label="Target">{row.target}</td>
                <td data-label="Measured">{row.measured}</td>
                <td data-label="Verdict">
                  <span className={`ma-check-status ma-check-status-${row.status}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="11" fill="currentColor" />
                      <path d={row.status === "pass" ? "m7 12 3 3 7-7" : row.status === "fail" ? "m8 8 8 8 M16 8l-8 8" : row.status === "warn" ? "M12 6v7 M12 17v.2" : "M7 12h10"} />
                    </svg>
                    <span>{inHand.includes(row) ? "Mastering can help" : statusLabel(row.status)}</span>
                  </span>
                </td>
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
