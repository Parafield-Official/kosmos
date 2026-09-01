import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BRAND_LOGO, WELCOME_PLACEHOLDER_S, WELCOME_VIDEO, WELCOME_VIDEO_GAIN } from "./flow";
import "./welcome.css";

export function WelcomeVideo({ onComplete }: { onComplete: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const fake = useRef({ elapsed: 0, timer: 0, origin: 0 });
  const watchCompleteRef = useRef(false);
  const uid = useId().replace(/:/g, "");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(WELCOME_PLACEHOLDER_S);
  const [unlocked, setUnlocked] = useState(false);
  const [placeholder, setPlaceholder] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const markFinished = useCallback(() => {
    if (watchCompleteRef.current) {
      setPlaying(false);
      setProgress(1);
      return;
    }
    watchCompleteRef.current = true;
    setPlaying(false);
    setProgress(1);
    setUnlocked(true);
    fake.current.elapsed = duration;
  }, [duration]);

  useEffect(() => {
    if (!placeholder || !playing) {
      return;
    }
    fake.current.origin = performance.now() - fake.current.elapsed * 1000;
    const tick = () => {
      const elapsed = (performance.now() - fake.current.origin) / 1000;
      fake.current.elapsed = elapsed;
      const next = Math.min(1, elapsed / WELCOME_PLACEHOLDER_S);
      setProgress(next);
      if (next >= 1) {
        markFinished();
      }
    };
    tick();
    fake.current.timer = window.setInterval(tick, 80);
    return () => {
      window.clearInterval(fake.current.timer);
      fake.current.elapsed = Math.min(WELCOME_PLACEHOLDER_S, (performance.now() - fake.current.origin) / 1000);
    };
  }, [placeholder, playing, markFinished]);

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === screenRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  function applyVideoVolume(node: HTMLVideoElement) {
    node.volume = 1;
    node.muted = muted;
  }

  function ensureAudioBoost(node: HTMLVideoElement) {
    applyVideoVolume(node);
    if (audioRef.current) {
      audioRef.current.gain.gain.value = WELCOME_VIDEO_GAIN;
      void audioRef.current.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(node);
    const gain = ctx.createGain();
    gain.gain.value = WELCOME_VIDEO_GAIN;
    source.connect(gain);
    gain.connect(ctx.destination);
    audioRef.current = { ctx, gain };
    void ctx.resume();
  }

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      audioRef.current = null;
      void audio?.ctx.close();
    };
  }, []);

  function seek(ratio: number) {
    if (!unlocked) {
      return;
    }
    const next = Math.min(1, Math.max(0, ratio));
    setProgress(next);
    const node = videoRef.current;
    const total = node?.duration || duration || WELCOME_PLACEHOLDER_S;
    fake.current.elapsed = next * total;
    fake.current.origin = performance.now() - fake.current.elapsed * 1000;
    if (node && node.duration) {
      node.currentTime = next * node.duration;
    }
    if (next >= 1) {
      setPlaying(false);
    }
  }

  function playFrom(ratio = progress) {
    if (ratio >= 1) {
      seek(0);
    }
    if (placeholder) {
      setPlaying(true);
      return;
    }
    const node = videoRef.current;
    if (node) {
      ensureAudioBoost(node);
      void node.play();
    }
  }

  function toggle() {
    if (playing) {
      if (placeholder) {
        setPlaying(false);
        return;
      }
      videoRef.current?.pause();
      return;
    }
    playFrom(progress);
  }

  function rewatch() {
    if (!unlocked) {
      const node = videoRef.current;
      if (node) {
        node.currentTime = 0;
        ensureAudioBoost(node);
        void node.play();
        return;
      }
      fake.current.elapsed = 0;
      fake.current.origin = performance.now();
      setProgress(0);
      setPlaying(true);
      return;
    }
    seek(0);
    playFrom(0);
  }

  function toggleMute(event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
    const next = !muted;
    setMuted(next);
    const node = videoRef.current;
    if (node) {
      node.muted = next;
      if (!next) {
        ensureAudioBoost(node);
      }
    }
  }

  function toggleFullscreen(event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
    const node = screenRef.current;
    if (!node) {
      return;
    }
    if (document.fullscreenElement === node) {
      void document.exitFullscreen();
      return;
    }
    void node.requestFullscreen();
  }

  function onScrubPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!unlocked) {
      return;
    }
    event.stopPropagation();
    const bar = event.currentTarget;
    if (event.type === "pointerdown") {
      bar.setPointerCapture(event.pointerId);
    } else if (!bar.hasPointerCapture(event.pointerId)) {
      return;
    }
    const rect = bar.getBoundingClientRect();
    seek((event.clientX - rect.left) / Math.max(1, rect.width));
  }

  const timeLabel = `${formatTime(progress * duration)} / ${formatTime(duration)}`;

  return (
    <section className="welcome" aria-label="Welcome">
      <div className="welcome-stage" aria-hidden="true">
        <div className="welcome-dim" />
        <svg className="welcome-light" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`${uid}-falloff`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(255, 236, 150)" stopOpacity="1" />
              <stop offset="6%" stopColor="rgb(255, 220, 110)" stopOpacity="0.72" />
              <stop offset="18%" stopColor="rgb(255, 204, 90)" stopOpacity="0.38" />
              <stop offset="46%" stopColor="rgb(255, 192, 80)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="rgb(255, 178, 70)" stopOpacity="0.07" />
            </linearGradient>
            <radialGradient id={`${uid}-floor`} cx="50%" cy="100%" r="62%">
              <stop offset="0%" stopColor="rgb(255, 210, 120)" stopOpacity="0.38" />
              <stop offset="40%" stopColor="rgb(255, 196, 90)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="rgb(255, 196, 90)" stopOpacity="0" />
            </radialGradient>
            <filter id={`${uid}-umbra`} x="-18%" y="-6%" width="136%" height="118%">
              <feGaussianBlur stdDeviation="0.55" />
            </filter>
            <filter id={`${uid}-penumbra`} x="-28%" y="-10%" width="156%" height="126%">
              <feGaussianBlur stdDeviation="1.85" />
            </filter>
            <filter id={`${uid}-haze`} x="-36%" y="-10%" width="172%" height="128%">
              <feGaussianBlur stdDeviation="3.1" />
            </filter>
          </defs>
          <ellipse cx="50" cy="102" rx="48" ry="20" fill={`url(#${uid}-floor)`} />
          <polygon
            points="42,0 58,0 96,102 4,102"
            fill={`url(#${uid}-falloff)`}
            filter={`url(#${uid}-haze)`}
            opacity="0.62"
          />
          <polygon
            points="44.2,0 55.8,0 86,102 14,102"
            fill={`url(#${uid}-falloff)`}
            filter={`url(#${uid}-penumbra)`}
            opacity="0.9"
          />
          <polygon
            points="46.6,0 53.4,0 72,102 28,102"
            fill={`url(#${uid}-falloff)`}
            filter={`url(#${uid}-umbra)`}
          />
        </svg>
        <div className="welcome-source" />
      </div>

      <div className="welcome-tv">
        <div className="welcome-tv-rim">
          <div className="welcome-tv-screen" ref={screenRef}>
            {placeholder ? (
              <div className="welcome-placeholder" data-playing={playing ? "true" : "false"}>
                <img src={BRAND_LOGO} alt="" width={400} height={289} />
              </div>
            ) : null}
            <video
              ref={videoRef}
              className="welcome-video"
              playsInline
              preload="auto"
              muted={muted}
              src={WELCOME_VIDEO}
              hidden={placeholder}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onVolumeChange={(event) => setMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
              onLoadedMetadata={(event) => {
                const node = event.currentTarget;
                setPlaceholder(false);
                setDuration(node.duration || WELCOME_PLACEHOLDER_S);
                applyVideoVolume(node);
              }}
              onTimeUpdate={(event) => {
                const node = event.currentTarget;
                if (!node.duration) {
                  return;
                }
                setProgress(node.currentTime / node.duration);
              }}
              onEnded={markFinished}
              onError={() => {
                setPlaceholder(true);
                setPlaying(false);
                setDuration(WELCOME_PLACEHOLDER_S);
              }}
            />

            <button
              type="button"
              className="welcome-hit"
              aria-label={playing ? "Pause" : "Play"}
              onClick={toggle}
            />

            <button
              type="button"
              className="btn btn-circle btn-clear welcome-frame-btn welcome-rewatch"
              aria-label="Rewatch"
              onClick={rewatch}
            >
              <RewatchIcon />
            </button>

            <button
              type="button"
              className={unlocked ? "btn btn-circle btn-clear welcome-frame-btn welcome-continue ready" : "btn btn-circle btn-clear welcome-frame-btn welcome-continue"}
              aria-label="Continue"
              disabled={!unlocked}
              onClick={onComplete}
            >
              <ChevronIcon />
            </button>

            <div className="welcome-overlay">
              <div className="welcome-yt">
                <div
                  className={unlocked ? "welcome-yt-progress scrub" : "welcome-yt-progress"}
                  role={unlocked ? "slider" : "progressbar"}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                  aria-label="Playback progress"
                  onPointerDown={unlocked ? onScrubPointer : undefined}
                  onPointerMove={unlocked ? onScrubPointer : undefined}
                >
                  <span className="welcome-yt-fill" style={{ width: `${progress * 100}%` }} />
                  {unlocked ? (
                    <span className="welcome-yt-thumb" style={{ left: `${progress * 100}%` }} aria-hidden="true" />
                  ) : null}
                </div>

                <div className="welcome-yt-bar">
                  <button
                    type="button"
                    className="welcome-yt-play"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle();
                    }}
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <span className="welcome-yt-time">{timeLabel}</span>
                  <span className="welcome-yt-spacer" aria-hidden="true" />
                  <button
                    type="button"
                    className="welcome-yt-icon"
                    aria-label={muted ? "Unmute" : "Mute"}
                    aria-pressed={muted}
                    onClick={toggleMute}
                  >
                    {muted ? <MutedIcon /> : <VolumeIcon />}
                  </button>
                  <button
                    type="button"
                    className="welcome-yt-icon"
                    aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                    onClick={toggleFullscreen}
                  >
                    {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="welcome-tv-bezel" />
      </div>
    </section>
  );
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M4 2.6v10.8L13.2 8Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M4 3h3v10H4zm5 0h3v10H9z" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M6.2 2.8 11 8l-4.8 5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RewatchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M11.8 4.2A5.4 5.4 0 1 0 13.2 9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M11.8 2.6v1.6h-1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M3.4 5.8h2L7.8 3.8v8.4L5.4 10.2H3.4z" fill="currentColor" />
      <path
        d="M10.4 5.6a2.6 2.6 0 0 1 0 4.8M11.7 4.2a4.8 4.8 0 0 1 0 7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M3.4 5.8h2L7.8 3.8v8.4L5.4 10.2H3.4z" fill="currentColor" />
      <path
        d="M10.1 5.4 13.9 10.6M13.9 5.4 10.1 10.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M3.4 6.2V3.4h2.8M9.8 3.4h2.8v2.8M12.6 9.8v2.8H9.8M6.2 12.6H3.4V9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M6.2 3.4H3.4v2.8M9.8 3.4h2.8v2.8M12.6 9.8v2.8H9.8M6.2 12.6H3.4V9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
