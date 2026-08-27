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
  markOnboarded,
  prefersReducedMotion,
  readStoredPlace,
  sameSize,
  sizeFor,
  storePlace,
  type Place,
} from "./flow";
import { useTypewriter } from "./useTypewriter";
import { startMeshFlow } from "./mesh-flow";
import { StartSlider } from "./StartSlider";
import { DebugDock } from "./DebugDock";
import { BrandMark } from "./ui/BrandMark";
import { Liquid } from "./ui/liquid";
import { WelcomeVideo } from "./WelcomeVideo";
import { applyClearedAccess, syncAccessState, type AccessSnapshot } from "./access";
import { AccessScreen } from "./AccessScreen";
import { CommunityScreen } from "./CommunityScreen";
import { MainApp } from "./main-app/MainApp";

type WindowChrome = {
  platform: NodeJS.Platform;
  fullscreen: boolean;
  maximized: boolean;
  expanded: boolean;
  showTrafficChrome: boolean;
};

function defaultWindowChrome(hosted: boolean): WindowChrome {
  const platform = window.kosmosNext?.platform ?? "darwin";
  return {
    platform,
    fullscreen: false,
    maximized: false,
    expanded: false,
    showTrafficChrome: hosted,
  };
}

function useWindowChrome(hosted: boolean): WindowChrome {
  const [chrome, setChrome] = useState<WindowChrome>(() => defaultWindowChrome(hosted));

  useEffect(() => {
    if (hosted || !window.kosmosNext?.getWindowChrome) {
      setChrome(defaultWindowChrome(hosted));
      return;
    }

    let alive = true;
    void window.kosmosNext.getWindowChrome().then((state) => {
      if (alive) {
        setChrome(state);
      }
    });
    const off = window.kosmosNext.onWindowChrome?.((state) => {
      setChrome(state);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [hosted]);

  return chrome;
}

export function App() {
  const [place, setPlace] = useState<Place>(readStoredPlace);
  const [flowSeed, setFlowSeed] = useState(0);
  const [accessSnapshot, setAccessSnapshot] = useState<AccessSnapshot | null>(null);
  const booted = useRef(false);
  const jumpRef = useRef<(next: Place) => void>(() => {});

  const lastSize = useRef(sizeFor(place));

  useLayoutEffect(() => {
    const size = sizeFor(place);
    if (place === "app") {
      markOnboarded();
    }
    void window.kosmosNext?.setPlace?.(place);
    window.kosmosNext?.reportPlace?.(place);
    if (!booted.current) {
      booted.current = true;
      lastSize.current = size;
      window.kosmosNext?.ready({ ...size, place });
      return;
    }
    if (!sameSize(lastSize.current, size)) {
      lastSize.current = size;
      void window.kosmosNext?.resize(size);
    }
  }, [place]);

  function go(next: Place) {
    setPlace(next);
    storePlace(next);
  }

  function jump(next: Place) {
    setPlace(next);
    storePlace(next);
    setFlowSeed((n) => n + 1);
  }

  jumpRef.current = jump;

  useEffect(() => {
    return window.kosmosNext?.onJump?.((next) => {
      jumpRef.current(next);
    });
  }, []);

  useEffect(() => {
    function clearAccess() {
      applyClearedAccess();
      void syncAccessState().then((snapshot) => {
        setAccessSnapshot({
          mic: { state: "prompt" },
          folder: { state: "prompt" },
          speechModel: snapshot.speechModel,
        });
      });
      setFlowSeed((n) => n + 1);
    }
    const off = window.kosmosNext?.onAccessReset?.(() => {
      clearAccess();
    });
    window.addEventListener("kosmos-access-reset", clearAccess);
    return () => {
      off?.();
      window.removeEventListener("kosmos-access-reset", clearAccess);
    };
  }, []);

  useEffect(() => {
    function restart() {
      jumpRef.current("mark");
    }
    window.addEventListener("kosmos-onboarding-restart", restart);
    return () => window.removeEventListener("kosmos-onboarding-restart", restart);
  }, []);

  useEffect(() => {
    if (place !== "community" && place !== "access") {
      return;
    }
    let alive = true;
    void syncAccessState().then((snapshot) => {
      if (alive) {
        setAccessSnapshot(snapshot);
      }
    });
    return () => {
      alive = false;
    };
  }, [place, flowSeed]);

  const size = sizeFor(place);
  const electron = Boolean(window.kosmosNext);
  const hosted = !electron;
  const windowChrome = useWindowChrome(hosted);
  const showTrafficGlass = place === "app" && (hosted || windowChrome.showTrafficChrome);

  let body: ReactNode;
  if (place === "mark") {
    body = <IntroMark key={`mark-${flowSeed}`} onComplete={() => go("intro")} />;
  } else if (place === "intro") {
    body = <IntroTagline key={`intro-${flowSeed}`} onComplete={() => go("brand")} />;
  } else if (place === "brand") {
    body = <IntroducingKosmos key={`brand-${flowSeed}`} onComplete={() => go("welcome")} />;
  } else if (place === "welcome") {
    body = <WelcomeVideo key={`welcome-${flowSeed}`} onComplete={() => go("community")} />;
  } else if (place === "community") {
    body = <CommunityScreen key={`community-${flowSeed}`} onComplete={() => go("access")} />;
  } else if (place === "access") {
    body = (
      <AccessScreen
        key={`access-${flowSeed}`}
        initialSnapshot={accessSnapshot}
        onComplete={() => go("app")}
      />
    );
  } else {
    body = <MainApp />;
  }

  return (
    <>
    <div
      className={electron ? "viewport native" : "viewport hosted"}
      data-place={place}
      data-traffic-chrome={windowChrome.showTrafficChrome ? "true" : "false"}
      data-window-expanded={windowChrome.expanded ? "true" : "false"}
      style={electron ? undefined : { width: size.width, height: size.height }}
    >
      <GlassMaterial />
      <div className="drag-strip drag-strip-start" aria-hidden="true" />
      <div className="drag-strip drag-strip-end" aria-hidden="true" />
      {showTrafficGlass ? <TrafficGlass hosted={hosted} /> : null}
      {place === "app" ? <BrandMark /> : null}
      <div className="frame">{body}</div>
      <p className="shell-footer">{INTRO_COPYRIGHT}</p>
    </div>
    {import.meta.env.DEV && !electron ? <DebugDock place={place} onJump={jump} /> : null}
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

function IntroMark({ onComplete }: { onComplete: () => void }) {
  const reduced = prefersReducedMotion();
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const doneId = window.setTimeout(() => completeRef.current(), reduced ? Math.min(MARK_MS, 650) : MARK_MS);
    return () => window.clearTimeout(doneId);
  }, [reduced]);

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

function IntroTagline({ onComplete }: { onComplete: () => void }) {
  const reduced = prefersReducedMotion();
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const { visible, typing } = useTypewriter(INTRO_TAGLINE, {
    reduced,
    charMs: INTRO_CHAR_MS,
    pauseMs: reduced ? Math.min(STATEMENT_MS, 900) : INTRO_PAUSE_MS,
    onComplete: () => completeRef.current(),
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
  const [visible, setVisible] = useState(reduced);
  const [phase, setPhase] = useState<"title" | "line">(reduced ? "line" : "title");

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
    const lineId = window.setTimeout(() => setPhase("line"), 720);
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
        <div className="intro-start">
          <StartSlider onComplete={() => completeRef.current()} />
        </div>
      </div>
    </section>
  );
}

