import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  INTRO_CHAR_MS,
  INTRO_COPYRIGHT,
  INTRO_HEADLINE,
  INTRO_PAUSE_MS,
  INTRO_STUDIO,
  INTRO_TAGLINE,
  MARK_MS,
  STATEMENT_MS,
  prefersReducedMotion,
  readStoredPlace,
  sameSize,
  sizeFor,
  storePlace,
  type Place,
} from "./flow";
import { useTypewriter } from "./useTypewriter";
import { startMeshFlow } from "./mesh-flow";
import { GlassLookSwitch } from "./GlassLookSwitch";
import { StartSlider } from "./StartSlider";
import { DebugDock } from "./DebugDock";
import { BrandMark } from "./ui/BrandMark";
import { Liquid } from "./ui/liquid-control";
import { WelcomeVideo } from "./WelcomeVideo";

export function App() {
  const [place, setPlace] = useState<Place>(readStoredPlace);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const booted = useRef(false);

  const lastSize = useRef(sizeFor(place));

  useLayoutEffect(() => {
    const size = sizeFor(place);
    if (!booted.current) {
      booted.current = true;
      lastSize.current = size;
      window.kosmosNext?.ready(size);
      return;
    }
    if (sameSize(lastSize.current, size)) {
      return;
    }
    lastSize.current = size;
    void window.kosmosNext?.resize(size);
  }, [place]);

  useEffect(() => {
    return window.kosmosNext?.onJump?.((next) => {
      setPinned(true);
      setPlace(next);
      storePlace(next);
    });
  }, []);

  function go(next: Place) {
    setPinned(false);
    setPlace(next);
    storePlace(next);
  }

  function jump(next: Place) {
    setPinned(true);
    setPlace(next);
    storePlace(next);
  }

  const size = sizeFor(place);
  const electron = Boolean(window.kosmosNext);

  let body: ReactNode;
  if (place === "mark") {
    body = <IntroMark pinned={pinned} onComplete={() => go("intro")} />;
  } else if (place === "intro") {
    body = <IntroTagline pinned={pinned} onComplete={() => go("brand")} />;
  } else if (place === "brand") {
    body = <IntroducingKosmos onComplete={() => go("welcome")} />;
  } else if (place === "welcome") {
    body = <WelcomeVideo onComplete={() => go("app")} />;
  } else {
    body = <Studio />;
  }

  return (
    <>
    <div
      className={electron ? "viewport native" : "viewport hosted"}
      data-place={place}
      style={electron ? undefined : { width: size.width, height: size.height }}
    >
      <GlassMaterial />
      <div className="drag-strip" aria-hidden="true" />
      <TrafficGlass hosted={!electron} />
      {place === "app" ? <BrandMark /> : null}
      <div className="frame">{body}</div>
      <p className="shell-footer">{INTRO_COPYRIGHT}</p>

      <div className={settingsOpen ? "settings open" : "settings"}>
        <Liquid
          type="button"
          shape="circle"
          className={settingsOpen ? "settings-toggle open" : "settings-toggle"}
          aria-label="Settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <SettingsIcon />
        </Liquid>
        {settingsOpen ? (
          <div className="settings-panel" role="dialog" aria-label="Settings">
            <p className="settings-kicker">theme</p>
            <GlassLookSwitch />
          </div>
        ) : null}
      </div>
    </div>
    {electron ? null : <DebugDock place={place} onJump={jump} />}
    </>
  );
}

function TrafficGlass({ hosted }: { hosted: boolean }) {
  return (
    <Liquid as="div" shape="pill" className="traffic-glass" aria-hidden="true">
      {hosted ? (
        <span className="traffic-glass-dots">
          <i className="dot close" />
          <i className="dot min" />
          <i className="dot max" />
        </span>
      ) : null}
    </Liquid>
  );
}

function GlassMaterial() {
  const meshRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!meshRef.current || prefersReducedMotion()) return;
    return startMeshFlow(meshRef.current);
  }, []);

  return (
    <div className="glass" aria-hidden="true">
      <div className="glass-backdrop" />
      <div className="glass-veil" />
      <div className="glass-depth" />
      <div className="glass-base" />
      <div className="glass-mesh" ref={meshRef}>
        <div className="mesh-blob blob-purple" />
        <div className="mesh-blob blob-blue" />
        <div className="mesh-blob blob-violet" />
        <div className="mesh-blob blob-indigo" />
        <div className="mesh-blob blob-orange" />
        <div className="mesh-blob blob-amber" />
        <div className="mesh-blob blob-coral" />
        <div className="mesh-blob blob-warm" />
      </div>
      <div className="glass-frost" />
      <div className="glass-specular" />
      <div className="glass-grain" />
      <div className="glass-rim" />
    </div>
  );
}

function IntroMark({ onComplete, pinned }: { onComplete: () => void; pinned: boolean }) {
  const reduced = prefersReducedMotion();
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    if (pinned) {
      return;
    }
    const doneId = window.setTimeout(() => completeRef.current(), reduced ? Math.min(MARK_MS, 650) : MARK_MS);
    return () => window.clearTimeout(doneId);
  }, [pinned, reduced]);

  return (
    <section className="intro intro-mark" data-visible={visible ? "true" : "false"} aria-label="Kosmos">
      <img
        className="intro-logo intro-logo-alone"
        src="/brand/logo.png"
        alt=""
        width={400}
        height={289}
      />
    </section>
  );
}

function IntroTagline({ onComplete, pinned }: { onComplete: () => void; pinned: boolean }) {
  const reduced = prefersReducedMotion();
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const { visible, typing } = useTypewriter(INTRO_TAGLINE, {
    reduced,
    charMs: INTRO_CHAR_MS,
    pauseMs: reduced ? Math.min(STATEMENT_MS, 900) : INTRO_PAUSE_MS,
    onComplete: pinned ? undefined : () => completeRef.current(),
  });

  return (
    <section className="intro" aria-label="Welcome">
      <p className="intro-line">
        {visible}
        {typing ? <span className="intro-cursor" aria-hidden="true" /> : null}
      </p>
    </section>
  );
}

function IntroducingKosmos({ onComplete }: { onComplete: () => void }) {
  const reduced = prefersReducedMotion();
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<"title" | "line">("line");

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      setPhase("line");
      return;
    }

    let showId = 0;
    const armId = window.requestAnimationFrame(() => {
      showId = window.requestAnimationFrame(() => setVisible(true));
    });
    const lineId = window.setTimeout(() => setPhase("line"), 640);
    return () => {
      window.cancelAnimationFrame(armId);
      window.cancelAnimationFrame(showId);
      window.clearTimeout(lineId);
    };
  }, [reduced]);

  return (
    <section
      className="intro intro-brand"
      data-visible={visible ? "true" : "false"}
      data-phase={phase}
      aria-label="Introducing Kosmos"
    >
      <div className="intro-stack">
        <div className="intro-copy">
          <p className="intro-headline" aria-hidden={!visible}>
            {INTRO_HEADLINE}
          </p>
          <p className="intro-studio" aria-hidden={phase !== "line"}>
            {INTRO_STUDIO}
          </p>
        </div>
        <div className="intro-start" data-show={phase === "line" ? "true" : "false"}>
          <StartSlider onComplete={() => completeRef.current()} />
        </div>
      </div>
    </section>
  );
}

function Studio() {
  return (
    <main className="studio">
      <div className="studio-body">
        <p className="kicker">studio</p>
        <h1>Open a book when the flow is ready.</h1>
        <p className="lede">Main shell. Spec next.</p>
      </div>
    </main>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
