import { useEffect, useRef, useState } from "react";
import { playbackErrorMessage } from "./playback-error";

export function TapePlayer({
  src,
  label,
  onTime,
}: {
  src: string;
  label: string;
  onTime?: (seconds: number, playing: boolean) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setError(null);
    pendingRef.current = false;
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const media = audio;
    function onTime() {
      setCurrent(media.currentTime);
      onTimeRef.current?.(media.currentTime, !media.paused);
    }
    function onMeta() {
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    }
    function onEnd() {
      if (!media.paused && !media.ended) return;
      requestRef.current += 1;
      pendingRef.current = false;
      setPlaying(false);
    }
    function onError() {
      requestRef.current += 1;
      pendingRef.current = false;
      setPlaying(false);
      setError(playbackErrorMessage());
    }
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", onEnd);
    audio.addEventListener("error", onError);
    return () => {
      requestRef.current += 1;
      pendingRef.current = false;
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("pause", onEnd);
      audio.removeEventListener("error", onError);
      audio.pause();
    };
  }, [src]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing || pendingRef.current) {
      requestRef.current += 1;
      pendingRef.current = false;
      audio.pause();
      setPlaying(false);
      return;
    }
    const request = ++requestRef.current;
    setError(null);
    pendingRef.current = true;
    setPlaying(true);
    try {
      // Reload a source that failed decoding/network loading before retrying.
      if (audio.error) audio.load();
      await audio.play();
    } catch (reason) {
      if (request === requestRef.current) {
        setPlaying(false);
        setError(playbackErrorMessage(reason));
      }
    } finally {
      if (request === requestRef.current) pendingRef.current = false;
    }
  }

  function seek(event: { currentTarget: HTMLDivElement; clientX: number }) {
    const audio = audioRef.current;
    if (!audio || duration <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const next = ((event.clientX - rect.left) / Math.max(1, rect.width)) * duration;
    audio.currentTime = Math.max(0, Math.min(duration, next));
    setCurrent(audio.currentTime);
    onTimeRef.current?.(audio.currentTime, !audio.paused);
  }

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="ma-tape-player">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="ma-tape-head">
        <p className="ma-tape-name">{label}</p>
        <span className="ma-tape-time">
          {formatTapeTime(current)} / {formatTapeTime(duration)}
        </span>
      </div>
      <div className="ma-tape-row">
        <button type="button" className="ma-tape-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseMark /> : <PlayMark />}
        </button>
        <div
          className="ma-tape-seek"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          aria-label={`${label} position`}
          style={{ ["--tape-pct" as string]: `${pct}%` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seek(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              seek(event);
            }
          }}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      {error ? <p className="ma-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function formatTapeTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function PlayMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 3.4 12.4 8 5.2 12.6V3.4Z" fill="currentColor" />
    </svg>
  );
}

function PauseMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.4h2v9.2H5zM9 3.4h2v9.2H9z" fill="currentColor" />
    </svg>
  );
}
