/**
 * Drives mesh blob divs with transform:translate() via requestAnimationFrame.
 * Each blob gets unique noise-based movement — organic, non-repeating, per-session random.
 * transform is GPU-composited so this works in every browser and Electron version.
 */

const TAU = Math.PI * 2;
const r = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function noise(t: number, a: number, b: number, c: number, d: number): number {
  return (
    Math.sin(t * 0.11 + a) * 0.38 +
    Math.sin(t * 0.19 + b) * 0.28 +
    Math.sin(t * 0.31 + c) * 0.20 +
    Math.sin(t * 0.47 + d) * 0.14
  );
}

interface BlobAnchor {
  el: HTMLElement;
  rangeX: number;
  rangeY: number;
  speed: number;
  pA: number;
  pB: number;
  pC: number;
  pD: number;
}

const BLOB_CONFIG: { cls: string; rangeX: number; rangeY: number; speed: number }[] = [
  { cls: "blob-purple",  rangeX: 60, rangeY: 45, speed: 0.7 },
  { cls: "blob-blue",    rangeX: 80, rangeY: 90, speed: 1.2 },
  { cls: "blob-violet",  rangeX: 70, rangeY: 60, speed: 1.0 },
  { cls: "blob-indigo",  rangeX: 65, rangeY: 80, speed: 1.3 },
  { cls: "blob-orange",  rangeX: 60, rangeY: 45, speed: 0.7 },
  { cls: "blob-amber",   rangeX: 75, rangeY: 85, speed: 1.1 },
  { cls: "blob-coral",   rangeX: 80, rangeY: 60, speed: 0.9 },
  { cls: "blob-warm",    rangeX: 65, rangeY: 75, speed: 1.2 },
];

export function startMeshFlow(container: HTMLElement): () => void {
  const anchors: BlobAnchor[] = [];

  for (const cfg of BLOB_CONFIG) {
    const el = container.querySelector<HTMLElement>(`.${cfg.cls}`);
    if (!el) continue;
    anchors.push({
      el,
      rangeX: cfg.rangeX,
      rangeY: cfg.rangeY,
      speed: cfg.speed,
      pA: r(0, TAU),
      pB: r(0, TAU),
      pC: r(0, TAU),
      pD: r(0, TAU),
    });
  }

  if (anchors.length === 0) return () => {};

  let raf = 0;
  const t0 = performance.now();

  function tick(now: number) {
    const t = (now - t0) / 1000;

    for (const a of anchors) {
      const st = t * a.speed;
      const nx = noise(st, a.pA, a.pB, a.pC, a.pD);
      const ny = noise(st + 100, a.pA + 2, a.pB + 3, a.pC + 5, a.pD + 7);

      const x = nx * a.rangeX;
      const y = ny * a.rangeY;

      a.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }

    raf = requestAnimationFrame(tick);
  }

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
