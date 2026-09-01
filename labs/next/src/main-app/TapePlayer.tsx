import { useEffect, useRef, useState } from "react";

export function TapePlayer({ src, label }: { src: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    function onTime() {
      setCurrent(audio.currentTime);
    }
    function onMeta() {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    }
    function onEnd() {
      setPlaying(false);
    }
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("pause", onEnd);
    };
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    void audio.play().then(() => setPlaying(true));
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
