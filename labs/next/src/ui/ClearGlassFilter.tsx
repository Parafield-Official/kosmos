/** SVG backdrop filter: Snell-style bend + chromatic dispersion.
    Chromium/Electron only (backdrop-filter: url()). Onboarding liquid
    chrome is unchanged — this is for clear buttons and the brand mark. */
export function ClearGlassFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="clear-glass-defs">
      <filter
        id="kosmos-clear-glass"
        x="-12%"
        y="-24%"
        width="124%"
        height="148%"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="frost" />
        <feTurbulence type="fractalNoise" baseFrequency="0.011 0.028" numOctaves="1" seed="3" result="height" />
        <feDisplacementMap
          in="frost"
          in2="height"
          scale="14"
          xChannelSelector="R"
          yChannelSelector="G"
          result="bent"
        />
        <feOffset in="bent" dx="1.1" dy="0" result="shiftR" />
        <feOffset in="bent" dx="-1.1" dy="0" result="shiftB" />
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
    </svg>
  );
}
