import { effect, frameLoop, init, surface } from "vgpu";
import type { FrameLoopHandle } from "vgpu";
import vaultLightShader from "./vault-light.wgsl";
import {
  AMBIENT,
  LIGHT_INTENSITY,
  LIGHT_RADIUS,
  LIGHT_RANGE,
  SPOT_INNER_DEG,
  SPOT_OUTER_DEG,
  DEPTH_B,
  DEPTH_T,
  DEPTH_X,
  WORLD_DEPTH,
  degToRad,
  lightWorldX,
  lightWorldZ,
} from "./vault-light-layout";

export type VaultLightState = {
  lit: boolean;
  occupied: number;
};

export function startVaultLight(canvas: HTMLCanvasElement, getState: () => VaultLightState): () => void {
  let disposed = false;
  let loop: FrameLoopHandle | undefined;
  let gpu: Awaited<ReturnType<typeof init>> | undefined;
  let shown = 0;

  void (async () => {
    try {
      await waitForSize(canvas);
      if (disposed) return;

      gpu = await init();
      if (disposed) {
        gpu.dispose();
        return;
      }

      gpu.onError((error) => {
        console.warn("[vault-light]", error.code ?? error.message, error);
      });

      const canvasSurface = surface(gpu, canvas, {
        dpr: [1, 2],
        alphaMode: "opaque",
        clearColor: [1, 1, 1, 1],
        label: "vault-light",
      });
      const lighting = effect(gpu, vaultLightShader, {
        label: "vault-light",
        set: { params: uniforms(canvasSurface.size, getState(), 0) },
      });

      canvas.classList.add("is-ready");
      loop = frameLoop(gpu, (frame) => {
        const state = getState();
        const target = state.lit ? 1 : 0.18;
        shown += (target - shown) * 0.08;
        lighting.set({ params: uniforms(canvasSurface.size, state, shown) });
        frame.pass(canvasSurface, lighting);
      });
    } catch (error) {
      console.warn("[vault-light] WebGPU lighting unavailable", error);
      canvas.classList.add("is-failed");
    }
  })();

  return () => {
    disposed = true;
    loop?.stop();
    gpu?.dispose();
  };
}

function waitForSize(canvas: HTMLCanvasElement) {
  return new Promise<void>((resolve) => {
    const ready = () => canvas.clientWidth > 0 && canvas.clientHeight > 0;
    if (ready()) {
      resolve();
      return;
    }
    const frame = () => {
      if (ready() || !canvas.isConnected) {
        resolve();
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

function uniforms(size: readonly [number, number], state: VaultLightState, shown: number) {
  return {
    res: [size[0], size[1]] as const,
    lit: shown,
    intensity: LIGHT_INTENSITY,
    depth: [DEPTH_T, DEPTH_B, DEPTH_X, WORLD_DEPTH] as const,
    falloff: [
      Math.cos(degToRad(SPOT_INNER_DEG)),
      Math.cos(degToRad(SPOT_OUTER_DEG)),
      LIGHT_RANGE,
      AMBIENT,
    ] as const,
    lightX: [lightWorldX(0), lightWorldX(1), lightWorldX(2), lightWorldX(3)] as const,
    extra: [lightWorldX(4), LIGHT_RADIUS, state.occupied, lightWorldZ()] as const,
  };
}
