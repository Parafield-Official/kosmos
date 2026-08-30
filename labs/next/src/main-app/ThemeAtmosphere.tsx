import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { atmosphereClouds, atmosphereCloudVars, readAtmosphereSeed } from "./theme";

export function ThemeAtmosphere() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const clouds = useMemo(() => atmosphereClouds(readAtmosphereSeed()).map(atmosphereCloudVars), []);

  useEffect(() => {
    const root = fieldRef.current?.parentElement;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let frame = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    const render = () => {
      currentX += (targetX - currentX) * 0.11;
      currentY += (targetY - currentY) * 0.11;
      root.style.setProperty("--ma-pointer-x", currentX.toFixed(3));
      root.style.setProperty("--ma-pointer-y", currentY.toFixed(3));
      if (Math.abs(targetX - currentX) > 0.002 || Math.abs(targetY - currentY) > 0.002) {
        frame = requestAnimationFrame(render);
      } else {
        frame = 0;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      targetX = ((event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5) * 2;
      targetY = ((event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5) * 2;
      if (!frame) {
        frame = requestAnimationFrame(render);
      }
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
      root.style.removeProperty("--ma-pointer-x");
      root.style.removeProperty("--ma-pointer-y");
    };
  }, []);

  return (
    <div className="ma-atmosphere" ref={fieldRef} aria-hidden="true">
      <span className="ma-atmosphere-light" />
      <span className="ma-atmosphere-ribbon" />
      <span className="ma-atmosphere-clouds">
        {clouds.map((style, index) => (
          <span className="ma-atmosphere-cloud" style={style as CSSProperties} key={index} />
        ))}
      </span>
      <span className="ma-atmosphere-noise" />
    </div>
  );
}

/** Pigment mesh + grain in the plaster of the vault. Salt offsets each face. */
export function VaultPigment({ salt }: { salt: number }) {
  const clouds = useMemo(
    () => atmosphereClouds(readAtmosphereSeed() ^ salt, 4, 0.62).map(atmosphereCloudVars),
    [salt],
  );

  return (
    <span className="vault-pigment" aria-hidden="true">
      {clouds.map((style, index) => (
        <span className="vault-pigment-cloud" style={style as CSSProperties} key={index} />
      ))}
      <span className="vault-pigment-grain" />
    </span>
  );
}
