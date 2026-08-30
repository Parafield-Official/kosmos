import { effect, frame, init, surface } from "vgpu";
import vaultLightShader from "./vault-light.wgsl";
import { startVaultVolume } from "./vault-volume";
import {
  DEPTH_B,
  DEPTH_T,
  DEPTH_X,
  LIGHT_INTENSITY,
  LIGHT_RADIUS,
  LIGHT_RANGE,
  SPOT_INNER_DEG,
  SPOT_OUTER_DEG,
  WORLD_DEPTH,
  degToRad,
  lightWorldX,
  lightWorldZ,
  type VaultLightState,
} from "./vault-light-layout";

export type { VaultLightState };

export type VaultLightKind = "webgpu" | "webgl";

export function startVaultLight(
  canvas: HTMLCanvasElement,
  getState: () => VaultLightState,
  onReady?: (kind: VaultLightKind) => void,
): () => void {
  let disposed = false;
  let stop: (() => void) | undefined;

  void (async () => {
    const gpuStop = await startWebGpuLight(canvas, getState, () => disposed);
    if (disposed) {
      gpuStop?.();
      return;
    }
    if (gpuStop) {
      stop = gpuStop;
      canvas.classList.add("is-ready");
      canvas.classList.remove("is-failed");
      onReady?.("webgpu");
      return;
    }
    try {
      stop = startVaultVolume(canvas, getState);
      canvas.classList.add("is-ready");
      canvas.classList.remove("is-failed");
      onReady?.("webgl");
    } catch (error) {
      console.warn("[vault-light] lighting unavailable", error);
      canvas.classList.add("is-failed");
    }
  })();

  return () => {
    disposed = true;
    stop?.();
  };
}

async function startWebGpuLight(
  canvas: HTMLCanvasElement,
  getState: () => VaultLightState,
  isDisposed: () => boolean,
): Promise<(() => void) | null> {
  let gpu: Awaited<ReturnType<typeof init>> | undefined;

  try {
    await waitForSize(canvas);
    if (isDisposed()) return null;

    gpu = await init();
    if (isDisposed()) {
      gpu.dispose();
      return null;
    }

    gpu.onError((error) => {
      console.warn("[vault-light]", error.code ?? error.message, error);
    });

    const canvasSurface = surface(gpu, canvas, {
      dpr: [1, 1.25],
      alphaMode: "opaque",
      clearColor: [0.5, 0.5, 0.5, 1],
      label: "vault-light",
    });
    const lighting = effect(gpu, vaultLightShader, {
      label: "vault-light",
      set: { params: uniforms(canvasSurface.size, getState(), 0) },
    });

    let shown = 0;
    let lastOccupied = -1;
    let lastLamps = -1;
    let raf = 0;
    let primed = false;
    const device = gpu;

    const draw = () => {
      if (isDisposed()) return;
      const state = getState();
      const target = 1;
      if (!primed) {
        shown = target;
        primed = true;
      } else {
        shown += (target - shown) * 0.14;
        if (Math.abs(target - shown) < 0.003) shown = target;
      }
      lastOccupied = state.occupied;
      lastLamps = state.lamps;
      lighting.set({ params: uniforms(canvasSurface.size, state, shown) });
      frame(device, (next) => {
        next.pass(canvasSurface, lighting);
      });
      if (shown !== target) schedule();
    };

    const schedule = () => {
      if (raf || isDisposed()) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    };

    canvasSurface.onResize(() => schedule());

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        if (!isDisposed()) draw();
        resolve();
      });
    });
    if (isDisposed()) {
      device.dispose();
      return null;
    }

    const poll = window.setInterval(() => {
      if (isDisposed()) return;
      const state = getState();
      const target = 1;
      if (state.occupied !== lastOccupied || state.lamps !== lastLamps || Math.abs(target - shown) > 0.003) {
        schedule();
      }
    }, 120);

    schedule();

    return () => {
      window.clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
      device.dispose();
    };
  } catch (error) {
    console.warn("[vault-light] WebGPU lighting unavailable", error);
    gpu?.dispose();
    return null;
  }
}

function waitForSize(canvas: HTMLCanvasElement) {
  return new Promise<void>((resolve) => {
    const ready = () => canvas.clientWidth > 0 && canvas.clientHeight > 0;
    if (ready()) {
      resolve();
      return;
    }
    const next = () => {
      if (ready() || !canvas.isConnected) {
        resolve();
        return;
      }
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
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
      state.lamps ?? 31,
    ] as const,
    lightX: [lightWorldX(0), lightWorldX(1), lightWorldX(2), lightWorldX(3)] as const,
    extra: [lightWorldX(4), LIGHT_RADIUS, state.occupied, lightWorldZ()] as const,
  };
}
