import { useEffect, useRef, useState } from "react";
import { resamplePcmToMono } from "../../../../src/core/audio/resample";
import { encodeWavPcm16 } from "../../../../src/core/audio/wav";
import { pickupKindPresentation } from "../../../../src/core/proof/pickup-display";
import { pickupLineBounds } from "../../../../src/core/teleprompter/session-tape";
import type { ChapterPickup } from "./store";

const MIC_KEY = "kosmos-booth-mic";
const TARGET_RATE = 44_100;

/**
 * Record a retake of one line. Stop, hear the old stretch vs the new one in
 * the chapter, then keep it or throw it away. Original tape stays untouched.
 */
export function PunchRecorder({
  pickup,
  progress,
  busy,
  error,
  onCancel,
  onPreview,
  onApply,
}: {
  pickup: ChapterPickup;
  progress?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onPreview?: (wav: Uint8Array) => Promise<{ currentWavBase64: string; patchedWavBase64: string }>;
  onApply: (wav: Uint8Array) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState<Uint8Array | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [clipsReady, setClipsReady] = useState(false);
  const [playing, setPlaying] = useState<"current" | "patched" | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const countRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const currentUrl = useRef<string | null>(null);
  const patchedUrl = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const kind = pickupKindPresentation(pickup.kind);
  const bounds = pickupLineBounds(pickup);

  useEffect(() => () => {
    stopCapture();
    stopPlayback();
    revokePreview();
  }, []);

  function revokePreview() {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    if (patchedUrl.current) URL.revokeObjectURL(patchedUrl.current);
    currentUrl.current = null;
    patchedUrl.current = null;
    setClipsReady(false);
  }

  function stopPlayback() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }

  function stopCapture() {
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }

  async function startCapture() {
    stopPlayback();
    revokePreview();
    setPending(null);
    setPreviewError(null);
    chunksRef.current = [];
    countRef.current = 0;
    setSeconds(0);
    const inputId = (() => {
      try {
        return window.localStorage.getItem(MIC_KEY);
      } catch {
        return null;
      }
    })();
    const audio: MediaTrackConstraints = {
      ...(inputId ? { deviceId: { exact: inputId } } : {}),
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;
      const AudioCtx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const mute = ctx.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (const sample of input) {
          sum += sample * sample;
        }
        setLevel(Math.min(1, Math.sqrt(input.length ? sum / input.length : 0) * 2.4));
        const mono = resamplePcmToMono(new Float32Array(input), ctx.sampleRate, TARGET_RATE);
        chunksRef.current.push(mono);
        countRef.current += mono.length;
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setSeconds(countRef.current / TARGET_RATE);
      }, 200);
    } catch {
      stopCapture();
    }
  }

  async function finish() {
    const total = countRef.current;
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    stopCapture();
    if (samples.length < TARGET_RATE * 0.2) {
      return;
    }
    const wav = encodeWavPcm16(samples, TARGET_RATE, 1);
    setPending(wav);
    if (!onPreview) {
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const clip = await onPreview(wav);
      revokePreview();
      currentUrl.current = wavUrl(clip.currentWavBase64);
      patchedUrl.current = wavUrl(clip.patchedWavBase64);
      setClipsReady(true);
    } catch (reason) {
      setPreviewError(reason instanceof Error ? reason.message : "Couldn't build a before/after clip.");
    } finally {
      setPreviewing(false);
    }
  }

  function play(which: "current" | "patched") {
    const url = which === "current" ? currentUrl.current : patchedUrl.current;
    if (!url) {
      return;
    }
    stopPlayback();
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(which);
    audio.addEventListener("ended", () => setPlaying(null));
    void audio.play().catch(() => setPlaying(null));
  }

  return (
    <div className="ma-scrim" role="dialog" aria-labelledby="ma-punch-title">
      <div className="ma-dialog neu-card ma-punch-dialog">
        <p className="ma-dialog-kicker">{progress ?? "Record this line"}</p>
        <h2 id="ma-punch-title" className="ma-dialog-title">
          {kind.label}
        </h2>
        <p className="ma-dialog-sub">
          {bounds.end > bounds.start
            ? `${bounds.start.toFixed(1)}s – ${bounds.end.toFixed(1)}s on the working take`
            : "Flagged range"}
        </p>
        <p className="ma-punch-expected">
          <span>Expected</span>
          {pickup.line_text || pickup.expected || "—"}
        </p>
        {pickup.heard && pickup.heard !== pickup.expected ? (
          <p className="ma-punch-heard">
            <span>Heard</span>
            {pickup.heard}
          </p>
        ) : null}

        {pending ? (
          <div className="ma-punch-compare">
            <p className="ma-punch-compare-copy">
              {previewing
                ? "Building a before and after…"
                : "Hear the old line, then this take, in the chapter. Keep it only if you like the new one."}
            </p>
            <div className="ma-dialog-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!clipsReady || previewing}
                onClick={() => play("current")}
                aria-pressed={playing === "current"}
              >
                {playing === "current" ? "Playing old" : "Play as it is now"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!clipsReady || previewing}
                onClick={() => play("patched")}
                aria-pressed={playing === "patched"}
              >
                {playing === "patched" ? "Playing new" : "Play with this take"}
              </button>
            </div>
            {previewError ? <p className="ma-error">{previewError}</p> : null}
          </div>
        ) : (
          <>
            <div className="ma-punch-meter" aria-hidden="true">
              <span style={{ transform: `scaleX(${level})` }} />
            </div>
            <p className="ma-punch-time">{seconds.toFixed(1)}s</p>
          </>
        )}

        {error ? <p className="ma-error">{error}</p> : null}
        <div className="ma-dialog-actions">
            <button type="button" className="btn btn-clear" onClick={onCancel} disabled={busy}>
              Use original
            </button>
          {recording ? (
            <button type="button" className="btn" onClick={() => void finish()} disabled={busy}>
              Stop
            </button>
          ) : pending ? (
            <>
              <button type="button" className="btn btn-clear" onClick={() => void startCapture()} disabled={busy || previewing}>
                Start over
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onApply(pending)}
                disabled={busy || previewing}
              >
                {busy ? "Saving…" : "Adopt"}
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => void startCapture()} disabled={busy}>
              Record
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function wavUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
