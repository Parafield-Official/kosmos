import { useEffect, useRef } from "react";
import { startVaultLight } from "./vault-light";
import type { VaultLightState } from "./vault-light-layout";

export function VaultLighting({
  lit,
  occupied,
  lamps,
}: {
  lit: boolean;
  occupied: number;
  lamps: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<VaultLightState>({ lit, occupied, lamps });
  stateRef.current = { lit, occupied, lamps };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = canvas.closest(".vault");
    const stop = startVaultLight(canvas, () => stateRef.current, (kind) => {
      root?.setAttribute("data-gpu-light", kind);
    });
    return () => {
      stop();
      root?.removeAttribute("data-gpu-light");
    };
  }, []);

  return <canvas ref={canvasRef} className="vault-light" aria-hidden="true" />;
}
