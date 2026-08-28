import { useEffect, useMemo, useRef, useState } from "react";
import { resamplePcmToMono } from "../../../../src/core/audio/resample";
import { encodeWavPcm16 } from "../../../../src/core/audio/wav";
import type { TranscriptWord } from "../../../../src/core/proof/align";
import { tokenizeManuscript } from "../../../../src/core/proof/normalize";
import { pickupKindPresentation } from "../../../../src/core/proof/pickup-display";
import { pickupLineBounds } from "../../../../src/core/teleprompter/session-tape";
import { flagKindLabel, flagWrongCopy } from "./flag-kind";
import { expandPickupToScope, punchTokenSpan, type PunchScope } from "./punch-scope";
import type { ChapterPickup } from "./store";

const MIC_KEY = "kosmos-booth-mic";
const TARGET_RATE = 44_100;

/**
 * Re-record a flagged sentence or paragraph onto the working file.
 * Original tape stays untouched. After the take: hear original vs new, then
 * adopt, start over, or keep the original stretch.
 */
export function PunchRecorder({
  pickup,
  manuscript,
  transcript,
  flags = [],
  progress,
  busy,
  error,
  onCancel,
  onPreview,
  onApply,
}: {
  pickup: ChapterPickup;
  manuscript: string;
  transcript: TranscriptWord[];
  flags?: ChapterPickup[];
  progress?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onPreview?: (
    wav: Uint8Array,
    bound: ChapterPickup,
  ) => Promise<{ currentWavBase64: string; patchedWavBase64: string }>;
  onApply: (wav: Uint8Array, bound: ChapterPickup) => void;
}) {
  const [scope, setScope] = useState<PunchScope>(
    pickup.selection_kind === "paragraph" ? "paragraph" : "sentence",
  );
  const bound = useMemo(
    () => expandPickupToScope(pickup, manuscript, transcript, scope),
    [manuscript, pickup, scope, transcript],
  );
  const [inputId, setInputId] = useState(() => {
    try {
      return window.localStorage.getItem(MIC_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
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
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const currentUrl = useRef<string | null>(null);
  const patchedUrl = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const kind = pickupKindPresentation(bound.kind);
  const bounds = pickupLineBounds(bound);
  const span = useMemo(
    () => punchTokenSpan(bound, manuscript, transcript),
    [bound, manuscript, transcript],
  );

  useEffect(() => () => {
    stopCapture();
    stopPlayback();
    revokePreview();
  }, []);

  useEffect(() => {
    let alive = true;
    async function listInputs() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (alive) {
          setAudioInputs(devices.filter((device) => device.kind === "audioinput" && device.deviceId));
        }
      } catch {
        // Permission arrives with the first record.
      }
    }
    void listInputs();
    navigator.mediaDevices.addEventListener?.("devicechange", listInputs);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", listInputs);
    };
  }, []);

  useEffect(() => {
    const root = promptRef.current;
    const mark = root?.querySelector(".is-now");
    if (!root || !mark) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    root.scrollTop += markRect.top - rootRect.top - root.clientHeight * 0.42 + markRect.height / 2;
  }, [span?.from, recording]);

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

  function disconnectProcessor() {
    processorRef.current?.disconnect();
    processorRef.current = null;
    muteRef.current?.disconnect();
    muteRef.current = null;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopCapture() {
    setRecording(false);
    setPaused(false);
    setLevel(0);
    disconnectProcessor();
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }

  function attachProcessor(ctx: AudioContext, source: MediaStreamAudioSourceNode) {
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    muteRef.current = mute;
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
    timerRef.current = window.setInterval(() => {
      setSeconds(countRef.current / TARGET_RATE);
    }, 200);
  }

  async function startCapture() {
    stopPlayback();
    revokePreview();
    stopCapture();
    setPending(null);
    setPreviewError(null);
    chunksRef.current = [];
    countRef.current = 0;
    setSeconds(0);
    setPaused(false);
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
      sourceRef.current = source;
      attachProcessor(ctx, source);
      setRecording(true);
    } catch {
      stopCapture();
    }
  }

  function pauseCapture() {
    if (!recording || paused) {
      return;
    }
    disconnectProcessor();
    setPaused(true);
    setLevel(0);
  }

  function continueCapture() {
    const ctx = ctxRef.current;
    const source = sourceRef.current;
    if (!ctx || !source || !paused) {
      return;
    }
    attachProcessor(ctx, source);
    setPaused(false);
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
      const clip = await onPreview(wav, bound);
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

  const capturing = recording && !paused;

  return (
    <div className="ma-scrim" role="dialog" aria-labelledby="ma-punch-title">
      <div className="ma-dialog neu-card ma-punch-dialog ma-punch-stage">
        <header className="ma-punch-head">
          <p className="ma-dialog-kicker">{progress ?? "Re-record"}</p>
          <h2 id="ma-punch-title" className="ma-dialog-title">
            {flagKindLabel(bound.kind)}
          </h2>
          <p className="ma-dialog-sub">{flagWrongCopy(bound)}</p>
          <p className="ma-punch-expected">
            <span>Sentence</span>
            {bound.line_text || bound.expected || "—"}
          </p>
          {bounds.end > bounds.start ? (
            <p className="ma-punch-time-range">
              {bounds.start.toFixed(1)}s – {bounds.end.toFixed(1)}s
            </p>
          ) : null}
        </header>

        <div className="ma-punch-body">
          <section className="ma-flow-block" aria-label="Mic and control">
            <h3 className="ma-flow-block-title">Mic and control</h3>
            <label className="ma-booth-input">
              <span>Microphone</span>
              <select
                value={inputId}
                disabled={recording}
                onChange={(event) => {
                  setInputId(event.target.value);
                  try {
                    window.localStorage.setItem(MIC_KEY, event.target.value);
                  } catch {
                    // Best effort.
                  }
                }}
              >
                <option value="">System default</option>
                {audioInputs.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="ma-booth-choices" role="radiogroup" aria-label="Re-record length">
              <button
                type="button"
                role="radio"
                aria-checked={scope === "sentence"}
                className={scope === "sentence" ? "is-on" : undefined}
                disabled={recording || Boolean(pending)}
                onClick={() => setScope("sentence")}
              >
                Sentence
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scope === "paragraph"}
                className={scope === "paragraph" ? "is-on" : undefined}
                disabled={recording || Boolean(pending)}
                onClick={() => setScope("paragraph")}
              >
                Paragraph
              </button>
            </div>
            {!pending ? (
              <>
                <div className="ma-punch-meter" aria-hidden="true">
                  <span style={{ transform: `scaleX(${level})` }} />
                </div>
                <p className="ma-punch-time">{formatPunchTime(seconds)}</p>
              </>
            ) : (
              <div className="ma-punch-compare">
                <p className="ma-punch-compare-copy">
                  {previewing
                    ? "Building original and newer…"
                    : "Hear the original stretch, then this take. Marks on the page are the misread, extra, and lacked flags."}
                </p>
                <div className="ma-dialog-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!clipsReady || previewing}
                    onClick={() => play("current")}
                    aria-pressed={playing === "current"}
                  >
                    {playing === "current" ? "Playing original" : "Listen original"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!clipsReady || previewing}
                    onClick={() => play("patched")}
                    aria-pressed={playing === "patched"}
                  >
                    {playing === "patched" ? "Playing newer" : "Listen newer"}
                  </button>
                </div>
                {previewError ? <p className="ma-error">{previewError}</p> : null}
              </div>
            )}
          </section>

          <section className="ma-flow-block ma-punch-prompt-block" aria-label="Teleprompter">
            <h3 className="ma-flow-block-title">Teleprompter</h3>
            <div className="ma-teleprompter is-dark ma-punch-teleprompter" ref={promptRef}>
              <PunchPrompt manuscript={manuscript} flags={flags} span={span} />
            </div>
          </section>
        </div>

        {error ? <p className="ma-error">{error}</p> : null}
        <div className="ma-dialog-actions">
          <button type="button" className="btn btn-clear" onClick={onCancel} disabled={busy || recording}>
            Use original
          </button>
          {capturing ? (
            <>
              <button type="button" className="btn" onClick={pauseCapture} disabled={busy}>
                Pause
              </button>
              <button type="button" className="btn" onClick={() => void finish()} disabled={busy}>
                Stop
              </button>
              <button
                type="button"
                className="btn btn-clear"
                onClick={() => void startCapture()}
                disabled={busy}
              >
                Start over
              </button>
            </>
          ) : paused ? (
            <>
              <button type="button" className="btn" onClick={continueCapture} disabled={busy}>
                Continue
              </button>
              <button
                type="button"
                className="btn btn-clear"
                onClick={() => void startCapture()}
                disabled={busy}
              >
                Start over
              </button>
            </>
          ) : pending ? (
            <>
              <button
                type="button"
                className="btn btn-clear"
                onClick={() => void startCapture()}
                disabled={busy || previewing}
              >
                Start over
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onApply(pending, bound)}
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
        <p className="ma-visually-hidden">{kind.label}</p>
      </div>
    </div>
  );
}

function PunchPrompt({
  manuscript,
  flags,
  span,
}: {
  manuscript: string;
  flags: ChapterPickup[];
  span: { from: number; to: number } | null;
}) {
  const tokens = useMemo(() => tokenizeManuscript(manuscript), [manuscript]);
  const flagByToken = useMemo(() => {
    const map = new Map<number, ChapterPickup>();
    for (const flag of flags) {
      if (typeof flag.manuscript_index === "number") {
        map.set(flag.manuscript_index, flag);
      }
    }
    return map;
  }, [flags]);

  if (tokens.length === 0) {
    return <p className="ma-teleprompter-empty">No text on this chapter.</p>;
  }

  return (
    <div className="ma-teleprompter-inner">
      {scriptBlocks(manuscript, tokens).map((block, index) => (
        <p key={index}>
          {block.parts.map((part, partIndex) => {
            if (part.tokenIndex === undefined) {
              return <span key={partIndex}>{part.text}</span>;
            }
            const flag = flagByToken.get(part.tokenIndex);
            const inSpan = Boolean(span && part.tokenIndex >= span.from && part.tokenIndex <= span.to);
            const isNow = Boolean(span && part.tokenIndex === span.from);
            const before = Boolean(span && part.tokenIndex < span.from && flag);
            const classes = [
              "ma-review-word",
              inSpan ? "is-selected" : "",
              isNow ? "is-now" : "",
              flag ? `is-flag is-flag-${flag.kind}` : "",
              before ? "is-before-flag" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <span key={partIndex} className={classes} title={flag ? flagKindLabel(flag.kind) : undefined}>
                {part.text}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function scriptBlocks(
  manuscript: string,
  tokens: ReturnType<typeof tokenizeManuscript>,
): Array<{ parts: Array<{ text: string; tokenIndex?: number }> }> {
  const blocks: Array<{ parts: Array<{ text: string; tokenIndex?: number }> }> = [];
  let offset = 0;
  for (const chunk of manuscript.split(/(\n+)/)) {
    if (!chunk || /^\n+$/.test(chunk) || !chunk.trim()) {
      offset += chunk.length;
      continue;
    }
    const start = offset;
    const end = offset + chunk.length;
    const inBlock = tokens.filter((token) => token.start >= start && token.end <= end);
    const parts: Array<{ text: string; tokenIndex?: number }> = [];
    let at = start;
    for (const token of inBlock) {
      if (token.start > at) {
        parts.push({ text: manuscript.slice(at, token.start) });
      }
      parts.push({ text: token.text, tokenIndex: token.index });
      at = token.end;
    }
    if (at < end) {
      parts.push({ text: manuscript.slice(at, end) });
    }
    if (parts.length) {
      blocks.push({ parts });
    }
    offset = end;
  }
  return blocks;
}

function formatPunchTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

function wavUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
