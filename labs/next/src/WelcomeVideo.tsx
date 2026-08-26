import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  INTRO_DISCORD,
  WELCOME_PLACEHOLDER_S,
  WELCOME_VIDEO,
} from "./flow";
import { Liquid } from "./ui/liquid-control";
import "./welcome.css";

export function WelcomeVideo({ onComplete }: { onComplete: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fake = useRef({ start: 0, elapsed: 0, raf: 0 });
  const uid = useId().replace(/:/g, "");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(WELCOME_PLACEHOLDER_S);
  const [finished, setFinished] = useState(false);
  const [placeholder, setPlaceholder] = useState(true);

  const markFinished = useCallback(() => {
    setPlaying(false);
    setProgress(1);
    setFinished(true);
  }, []);

  useEffect(() => {
    if (!placeholder || finished || !playing) {
      return;
    }
    const tick = (now: number) => {
      if (!fake.current.start) {
        fake.current.start = now - fake.current.elapsed * 1000;
      }
      const elapsed = (now - fake.current.start) / 1000;
      fake.current.elapsed = elapsed;
      const next = Math.min(1, elapsed / WELCOME_PLACEHOLDER_S);
      setProgress(next);
      if (next >= 1) {
        markFinished();
        return;
      }
      fake.current.raf = window.requestAnimationFrame(tick);
    };
    fake.current.raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(fake.current.raf);
  }, [placeholder, playing, finished, markFinished]);

  function toggle() {
    if (finished) {
      return;
    }
    if (placeholder) {
      if (playing) {
        fake.current.start = 0;
      }
      setPlaying((value) => !value);
      return;
    }
    const node = videoRef.current;
    if (!node) {
      return;
    }
    if (node.paused) {
      void node.play();
    } else {
      node.pause();
    }
  }

  function seek(value: number) {
    const next = Math.min(1, Math.max(0, value));
    if (placeholder) {
      fake.current.elapsed = next * WELCOME_PLACEHOLDER_S;
      fake.current.start = 0;
      setProgress(next);
      if (next >= 1) {
        markFinished();
      }
      return;
    }
    const node = videoRef.current;
    if (!node || !node.duration) {
      return;
    }
    node.currentTime = next * node.duration;
    setProgress(next);
    if (next >= 0.995) {
      markFinished();
    }
  }

  const timeLabel = formatTime(progress * duration);

  return (
    <section className="welcome" aria-label="Welcome">
      <div className="welcome-stage" aria-hidden="true">
        <div className="welcome-dim" />
        <svg className="welcome-light" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`${uid}-falloff`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(255, 236, 150)" stopOpacity="0.92" />
              <stop offset="6%" stopColor="rgb(255, 220, 110)" stopOpacity="0.58" />
              <stop offset="18%" stopColor="rgb(255, 204, 90)" stopOpacity="0.28" />
              <stop offset="46%" stopColor="rgb(255, 192, 80)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="rgb(255, 178, 70)" stopOpacity="0.045" />
            </linearGradient>
            <radialGradient id={`${uid}-floor`} cx="50%" cy="100%" r="62%">
              <stop offset="0%" stopColor="rgb(255, 210, 120)" stopOpacity="0.28" />
              <stop offset="40%" stopColor="rgb(255, 196, 90)" stopOpacity="0.08" />
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
            points="42,8.2 58,8.2 96,102 4,102"
            fill={`url(#${uid}-falloff)`}
            filter={`url(#${uid}-haze)`}
            opacity="0.48"
          />
          <polygon
            points="44.2,8.2 55.8,8.2 86,102 14,102"
            fill={`url(#${uid}-falloff)`}
            filter={`url(#${uid}-penumbra)`}
            opacity="0.78"
          />
          <polygon
            points="46.6,8.2 53.4,8.2 72,102 28,102"
            fill={`url(#${uid}-falloff)`}
            filter={`url(#${uid}-umbra)`}
          />
        </svg>
        <div className="welcome-source" />
      </div>

      <div className="welcome-hero">
        <div className="welcome-frame">
          {placeholder ? (
            <div className="welcome-placeholder" data-playing={playing ? "true" : "false"}>
              <img src="/brand/logo.png" alt="" width={400} height={289} />
              <p>Welcome to Kosmos</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="welcome-video"
              playsInline
              preload="metadata"
              src={WELCOME_VIDEO}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || WELCOME_PLACEHOLDER_S)}
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
                setDuration(WELCOME_PLACEHOLDER_S);
              }}
            />
          )}
        </div>

        <div className="welcome-controls">
          <button
            type="button"
            className="welcome-play"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <input
            type="range"
            className="welcome-seek"
            min={0}
            max={1}
            step={0.001}
            value={progress}
            style={{ "--seek": `${progress * 100}%` } as CSSProperties}
            aria-label="Playback"
            onInput={(event) => seek(Number(event.currentTarget.value))}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <span className="welcome-time">{timeLabel}</span>
        </div>
      </div>

      <div className={finished ? "welcome-after show" : "welcome-after"}>
        {finished ? (
          <>
            <a className="welcome-discord" href={INTRO_DISCORD} target="_blank" rel="noreferrer">
              <DiscordIcon />
              Join our community.
            </a>
            <Liquid type="button" shape="pill" className="welcome-continue" onClick={onComplete}>
              Continue
            </Liquid>
          </>
        ) : null}
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
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 2.6v10.8L13.2 8Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 3h3v10H4zm5 0h3v10H9z" fill="currentColor" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.27 5.33A17.4 17.4 0 0 0 14.89 4c-.2.37-.43.85-.59 1.24a16.1 16.1 0 0 0-4.6 0A11.3 11.3 0 0 0 9.1 4a17.3 17.3 0 0 0-4.4 1.35C1.4 9.05.64 12.64 1.02 16.18A17.6 17.6 0 0 0 6.3 19c.37-.5.7-1.03.98-1.58a11.4 11.4 0 0 1-1.55-.75c.13-.1.26-.2.38-.3a12.4 12.4 0 0 0 10.78 0c.13.1.25.2.38.3-.5.3-1.02.55-1.56.76.28.55.61 1.08.98 1.58a17.5 17.5 0 0 0 5.3-2.82c.42-4.08-.71-7.64-2.72-10.86ZM8.52 13.86c-.83 0-1.5-.78-1.5-1.73s.66-1.73 1.5-1.73 1.52.78 1.5 1.73c0 .95-.67 1.73-1.5 1.73Zm6.96 0c-.83 0-1.5-.78-1.5-1.73s.66-1.73 1.5-1.73 1.52.78 1.5 1.73c0 .95-.66 1.73-1.5 1.73Z"
      />
    </svg>
  );
}
