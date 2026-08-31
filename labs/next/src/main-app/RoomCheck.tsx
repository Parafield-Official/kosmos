import { useRef, useState } from "react";
import { analyzeRoomTest, type RoomTestReport } from "../../../../src/core/acx/room";
import { readEnginePrefs } from "./engine-prefs";
import type { RoomCheckReport } from "./store";

const TARGET_SECONDS = 12;
const SETTLE_SECONDS = 0.4;
const AUDIBLE_FLOOR_DBFS = -60;
const MIC_KEY = "kosmos-booth-mic";

function formatDb(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)} dBFS`;
}

function formatCheckedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function roomChipLabel(report?: RoomCheckReport): string {
  if (!report) {
    return "Room";
  }
  if (report.status === "pass") {
    return "Quiet";
  }
  if (report.status === "warn") {
    return "Close";
  }
  return "Noisy";
}

function roomQuality(report: RoomCheckReport): { title: string; detail: string } {
  const noMic = !Number.isFinite(report.noiseFloorDbfs);
  if (report.status === "fail" && (report.durationSeconds === 0 || noMic)) {
    return {
      title: "Check failed",
      detail: "That recording didn't come through. Try again with the microphone on.",
    };
  }
  if (report.status === "warn" && report.durationSeconds > 0 && report.durationSeconds < 10) {
    return {
      title: "Try that again",
      detail: "That was too short. Sit still and don't talk for about 12 seconds, then check again.",
    };
  }
  if (report.status === "warn" && report.durationSeconds > 20) {
    return {
      title: "Try that again",
      detail: "That ran long. Sit still for about 12 seconds, then check again.",
    };
  }
  if (report.status === "warn" && noMic) {
    return {
      title: "No room sound",
      detail: "The mic picked up nothing — computer silence, not the room. Choose a real microphone and make sure it isn't muted.",
    };
  }
  if (report.status === "fail") {
    return {
      title: "Too noisy",
      detail: `This place is too loud to record a whole book. Background noise would sit at ${formatDb(report.predictedFloorDbfs)}; Audible needs ${AUDIBLE_FLOOR_DBFS} dBFS or quieter. Fans, HVAC, traffic, a loud computer, and the mic's own hiss all count. You can still record — this is a warning, not a lock.`,
    };
  }
  if (report.status === "warn") {
    return {
      title: "A bit noisy",
      detail: `Close to Audible's limit. After your voice is brought up to level, background noise would sit at ${formatDb(report.predictedFloorDbfs)} (needs ${AUDIBLE_FLOOR_DBFS} dBFS or quieter). You can record, but listen to a take before you do the whole book.`,
    };
  }
  return {
    title: "Quiet enough",
    detail: "Background noise is low enough for Audible. This is a good room to record the book.",
  };
}

function toSaved(report: RoomTestReport): RoomCheckReport {
  return {
    recordedAt: new Date().toISOString(),
    durationSeconds: report.durationSeconds,
    noiseFloorDbfs: report.noiseFloorDbfs,
    speechRmsDbfs: report.speechRmsDbfs,
    neededBoostDb: report.neededBoostDb,
    predictedFloorDbfs: report.predictedFloorDbfs,
    targetRmsDbfs: report.targetRmsDbfs,
    status: report.status,
    warning: report.warning,
  };
}

async function openRoomStream(): Promise<MediaStream> {
  const base: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  let deviceId = "";
  try {
    deviceId = window.localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    deviceId = "";
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base,
    });
  } catch (reason) {
    if (!deviceId) {
      throw reason;
    }
    return navigator.mediaDevices.getUserMedia({ audio: base });
  }
}

export function RoomCheck({
  report,
  onReport,
}: {
  report?: RoomCheckReport;
  onReport: (next: RoomCheckReport) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  async function runCheck() {
    if (recording) {
      return;
    }
    setError(null);
    setRecording(true);
    setElapsed(0);
    try {
      const stream = await openRoomStream();
      const AudioCtx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const sampleRate = ctx.sampleRate || 48_000;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      const chunks: Float32Array[] = [];
      const skipSamples = Math.round(sampleRate * SETTLE_SECONDS);
      let skipped = 0;
      processor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        if (skipped < skipSamples) {
          const remain = skipSamples - skipped;
          if (data.length <= remain) {
            skipped += data.length;
            return;
          }
          chunks.push(new Float32Array(data.subarray(remain)));
          skipped = skipSamples;
          return;
        }
        chunks.push(new Float32Array(data));
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);

      await new Promise<void>((resolve, reject) => {
        const started = performance.now();
        const listenMs = (TARGET_SECONDS + SETTLE_SECONDS) * 1000;
        const tick = window.setInterval(() => {
          setElapsed(Math.min(TARGET_SECONDS, (performance.now() - started) / 1000));
        }, 200);
        const finish = () => {
          window.clearInterval(tick);
          processor.disconnect();
          source.disconnect();
          mute.disconnect();
          stream.getTracks().forEach((track) => track.stop());
          void ctx.close();
          stopRef.current = null;
        };
        const timer = window.setTimeout(() => {
          finish();
          resolve();
        }, listenMs);
        stopRef.current = () => {
          window.clearTimeout(timer);
          finish();
          reject(new Error("cancelled"));
        };
      });

      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      const measured = analyzeRoomTest({
        samples,
        sampleRate,
        channels: 1,
        targetRmsDbfs: readEnginePrefs().acx_target_rms_dbfs,
      });
      onReport(toSaved(measured));
    } catch (reason) {
      if (reason instanceof Error && reason.message === "cancelled") {
        return;
      }
      setError(reason instanceof Error ? reason.message : "Could not record room tone.");
    } finally {
      setRecording(false);
      setElapsed(0);
    }
  }

  const shown = report;
  const quality = shown ? roomQuality(shown) : null;
  const checkedAt = shown ? formatCheckedAt(shown.recordedAt) : "";

  return (
    <section className="ma-room is-sheet" aria-label="Room check">
      <p className="ma-room-lead">
        Sit still for {TARGET_SECONDS} seconds. This measures the room — fans, traffic, computer, mic hiss — not your
        voice. It does not lock recording.
      </p>
      <div className="ma-step-actions">
        <button type="button" className="btn btn-clear" disabled={recording} onClick={() => void runCheck()}>
          {recording ? `Listening… ${elapsed.toFixed(0)}s` : shown ? "Check again" : "Record silence"}
        </button>
        {recording ? (
          <button type="button" className="btn" onClick={() => stopRef.current?.()}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="ma-error">{error}</p> : null}
      {shown && quality ? (
        <div className={`ma-room-result is-${shown.status}`} aria-live="polite">
          <p className="ma-room-status">{quality.title}</p>
          {checkedAt ? <p className="ma-room-when">Checked {checkedAt}</p> : null}
          <p className="ma-room-detail">{quality.detail}</p>
          <dl>
            <div>
              <dt>Quiet time</dt>
              <dd>{shown.durationSeconds.toFixed(1)} s</dd>
            </div>
            <div>
              <dt>Background noise</dt>
              <dd>{formatDb(shown.noiseFloorDbfs)}</dd>
            </div>
            <div>
              <dt>What Audible hears</dt>
              <dd>{formatDb(shown.predictedFloorDbfs)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}
