import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { atmosphereClouds, atmosphereCloudVars, marbleVeins, mulberry32, readAtmosphereSeed } from "./theme";

export function ThemeAtmosphere() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const clouds = useMemo(() => atmosphereClouds(readAtmosphereSeed()).map(atmosphereCloudVars), []);

  useEffect(() => {
    const field = fieldRef.current;
    const root = field?.parentElement;
    if (!field || !root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let frame = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let windowActive = true;

    const render = () => {
      if (!windowActive || document.hidden) {
        frame = 0;
        return;
      }
      currentX += (targetX - currentX) * 0.11;
      currentY += (targetY - currentY) * 0.11;
      // Scope the changing custom properties to the atmosphere subtree. They
      // used to live on the whole app root, forcing style invalidation across
      // every screen descendant for a purely decorative parallax update.
      field.style.setProperty("--ma-pointer-x", currentX.toFixed(3));
      field.style.setProperty("--ma-pointer-y", currentY.toFixed(3));
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

    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const onWindowBlur = () => {
      windowActive = false;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onWindowFocus = () => {
      windowActive = true;
      if (!frame && (Math.abs(targetX - currentX) > 0.002 || Math.abs(targetY - currentY) > 0.002)) {
        frame = requestAnimationFrame(render);
      }
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      cancelAnimationFrame(frame);
      field.style.removeProperty("--ma-pointer-x");
      field.style.removeProperty("--ma-pointer-y");
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

/** White marble with a per-user theme-colour stain. Salt offsets each face. */
export function VaultPigment({ salt }: { salt: number }) {
  const seed = readAtmosphereSeed() ^ salt;
  const clouds = useMemo(() => marbleVeins(seed, 7).map(atmosphereCloudVars), [seed]);
  const grain = useMemo(() => {
    const random = mulberry32(seed ^ 0x9e37);
    return {
      "--grain-x": `${(random() * 70).toFixed(1)}%`,
      "--grain-y": `${(random() * 70).toFixed(1)}%`,
      "--grain-r": `${(-11 + random() * 22).toFixed(1)}deg`,
      "--grain-s": `${(1.04 + random() * 0.18).toFixed(3)}`,
    } as CSSProperties;
  }, [seed]);

  return (
    <span className="vault-pigment" style={grain} aria-hidden="true">
      {clouds.map((style, index) => (
        <span className="vault-pigment-cloud" style={style as CSSProperties} key={index} />
      ))}
      <span className="vault-pigment-vein" />
      <span className="vault-pigment-grain" />
    </span>
  );
}
