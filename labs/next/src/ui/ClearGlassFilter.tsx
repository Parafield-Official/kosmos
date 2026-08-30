/** SVG backdrop filter: Snell-style bend + chromatic dispersion.
    Chromium/Electron only (backdrop-filter: url()). Onboarding liquid
    chrome is unchanged — this is for clear buttons and the brand mark. */
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

export function ClearGlassFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="clear-glass-defs">
      <DispersionFilter id="kosmos-clear-glass" scale={14} dx={1.1} blur={0.7} />
      <filter
        id="kosmos-clear-glass-pane"
        x="-8%"
        y="-8%"
        width="116%"
        height="116%"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.35" result="frost" />
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.02" numOctaves="1" seed="5" result="height" />
        <feDisplacementMap
          in="frost"
          in2="height"
          scale="7"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
