/** SVG filters for Labs chrome.

    `kosmos-clear-glass` — small clear buttons: Snell bend + RGB split.
    `kosmos-liquid-glass` — lock pane: low-frequency water refraction on
    the vault opening (filter, not backdrop-filter). Sharp UI sits in chrome.
    `kosmos-liquid-glass-chip` — HUD capsules. No chromatic fringe. */
function DispersionFilter({
  id,
  scale,
  dx,
  blur,
}: {
  id: string;
  scale: number;
  dx: number;
  blur: number;
}) {
  return (
    <filter
      id={id}
      x="-14%"
      y="-18%"
      width="128%"
      height="136%"
      colorInterpolationFilters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="frost" />
      <feTurbulence type="fractalNoise" baseFrequency="0.011 0.028" numOctaves="1" seed="3" result="height" />
      <feDisplacementMap
        in="frost"
        in2="height"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
        result="bent"
      />
      <feOffset in="bent" dx={dx} dy="0" result="shiftR" />
      <feOffset in="bent" dx={-dx} dy="0" result="shiftB" />
      <feColorMatrix
        in="shiftR"
        type="matrix"
        values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
        result="red"
      />
      <feColorMatrix
        in="bent"
        type="matrix"
        values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
        result="green"
      />
      <feColorMatrix
        in="shiftB"
        type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
        result="blue"
      />
      <feBlend in="red" in2="green" mode="screen" result="rg" />
      <feBlend in="rg" in2="blue" mode="screen" />
    </filter>
  );
}

function LiquidGlassFilter({
  id,
  scale,
  frequency,
}: {
  id: string;
  scale: number;
  frequency: string;
}) {
  return (
    <filter
      id={id}
      x="-28%"
      y="-28%"
      width="156%"
      height="156%"
      colorInterpolationFilters="sRGB"
    >
      <feTurbulence
        type="turbulence"
        baseFrequency={frequency}
        numOctaves="1"
        seed="4"
        stitchTiles="stitch"
        result="waves"
      />
      <feGaussianBlur in="waves" stdDeviation="18" result="lens" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="lens"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
        result="bent"
      />
      <feColorMatrix in="bent" type="saturate" values="1.28" />
    </filter>
  );
}

export function ClearGlassFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="clear-glass-defs">
      <DispersionFilter id="kosmos-clear-glass" scale={14} dx={1.1} blur={0.7} />
      <LiquidGlassFilter id="kosmos-liquid-glass" scale={18} frequency="0.0028 0.0046" />
      <LiquidGlassFilter id="kosmos-liquid-glass-chip" scale={16} frequency="0.007 0.012" />
    </svg>
  );
}
