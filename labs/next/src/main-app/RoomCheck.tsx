import { useRef, useState } from "react";
import { analyzeRoomTest, type RoomTestReport } from "../../../../src/core/acx/room";
import { readEnginePrefs } from "./engine-prefs";
import type { RoomCheckReport } from "./store";

const TARGET_SECONDS = 12;

function formatDb(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)} dBFS`;
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const AudioCtx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const sampleRate = ctx.sampleRate || 48_000;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);

      await new Promise<void>((resolve, reject) => {
        const started = performance.now();
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
        }, TARGET_SECONDS * 1000);
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
  const statusLabel = shown?.status === "pass" ? "Pass" : shown?.status === "warn" ? "Close" : shown?.status === "fail" ? "Treat the room" : null;

  return (
    <section className="ma-room" aria-label="Room check">
      <header className="ma-glossary-head">
        <h2>Room check</h2>
        <p>Record {TARGET_SECONDS} seconds of intended silence. If the floor is loud, treat the room before a whole book.</p>
      </header>
      <div className="ma-step-actions">
        <button type="button" className="btn" disabled={recording} onClick={() => void runCheck()}>
          {recording ? `Listening… ${elapsed.toFixed(0)}s` : shown ? "Check again" : "Record silence"}
        </button>
        {recording ? (
          <button type="button" className="btn btn-clear" onClick={() => stopRef.current?.()}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="ma-error">{error}</p> : null}
      {shown ? (
        <div className={`ma-room-result is-${shown.status}`}>
          <p className="ma-room-status">{statusLabel}</p>
          <dl>
            <div>
              <dt>Silence</dt>
              <dd>{shown.durationSeconds.toFixed(1)} s</dd>
            </div>
            <div>
              <dt>Room noise</dt>
              <dd>{formatDb(shown.noiseFloorDbfs)}</dd>
            </div>
            <div>
              <dt>After boost</dt>
              <dd>{formatDb(shown.predictedFloorDbfs)}</dd>
            </div>
          </dl>
          <p>{shown.warning}</p>
        </div>
      ) : null}
    </section>
  );
}
