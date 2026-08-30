import { useEffect, useRef } from "react";
import { startVaultLight } from "./vault-light";

export function VaultLighting({ lit, occupied }: { lit: boolean; occupied: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ lit, occupied });
  stateRef.current = { lit, occupied };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startVaultLight(canvas, () => stateRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="vault-light"
      aria-hidden="true"
    />
  );
}
