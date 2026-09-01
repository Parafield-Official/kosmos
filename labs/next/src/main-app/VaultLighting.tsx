import { useEffect, useRef } from "react";
import { startVaultLight, type VaultLightController } from "./vault-light";
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
  const lightRef = useRef<VaultLightController | null>(null);
  const stateRef = useRef<VaultLightState>({ lit, occupied, lamps });
  stateRef.current = { lit, occupied, lamps };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = canvas.closest(".vault");
    const light = startVaultLight(canvas, () => stateRef.current, (kind) => {
      root?.setAttribute("data-gpu-light", kind);
    });
    lightRef.current = light;
    return () => {
      lightRef.current = null;
      light.dispose();
      root?.removeAttribute("data-gpu-light");
    };
  }, []);

  // State changes are already known to React, so drive the event-rendered
  // lighting directly instead of polling the component state eight times a
  // second for the entire lifetime of the Show Box.
  useEffect(() => {
    lightRef.current?.invalidate();
  }, [lit, occupied, lamps]);

  return <canvas ref={canvasRef} className="vault-light" aria-hidden="true" />;
}
