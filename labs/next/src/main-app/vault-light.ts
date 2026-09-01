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

export interface VaultLightController {
  invalidate(): void;
  dispose(): void;
}

type LightBackend = VaultLightController;

export function startVaultLight(
  canvas: HTMLCanvasElement,
  getState: () => VaultLightState,
  onReady?: (kind: VaultLightKind) => void,
): VaultLightController {
  let disposed = false;
  let backend: LightBackend | undefined;
  let invalidated = true;
  const pending = new AbortController();

  void (async () => {
    const gpuStop = await startWebGpuLight(canvas, getState, () => disposed, pending.signal);
    if (disposed) {
      gpuStop?.dispose();
      return;
    }
    if (gpuStop) {
      backend = gpuStop;
      if (invalidated) backend.invalidate();
      invalidated = false;
      canvas.classList.add("is-ready");
      canvas.classList.remove("is-failed");
      onReady?.("webgpu");
      return;
    }
    try {
      backend = startVaultVolume(canvas, getState);
      if (invalidated) backend.invalidate();
      invalidated = false;
      canvas.classList.add("is-ready");
      canvas.classList.remove("is-failed");
      onReady?.("webgl");
    } catch (error) {
      console.warn("[vault-light] lighting unavailable", error);
      canvas.classList.add("is-failed");
    }
  })();

  return {
    invalidate() {
      invalidated = true;
      backend?.invalidate();
      if (backend) invalidated = false;
    },
    dispose() {
      disposed = true;
      pending.abort();
      backend?.dispose();
    },
  };
}

async function startWebGpuLight(
  canvas: HTMLCanvasElement,
  getState: () => VaultLightState,
  isDisposed: () => boolean,
  signal: AbortSignal,
): Promise<LightBackend | null> {
  let gpu: Awaited<ReturnType<typeof init>> | undefined;
  let cleanupListeners: (() => void) | undefined;

  try {
    await waitForSize(canvas, signal);
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
    let raf = 0;
    let primed = false;
    let needsDraw = true;
    let windowActive = true;
    const device = gpu;

    const draw = () => {
      if (isDisposed()) return;
      needsDraw = false;
      const state = getState();
      const target = 1;
      if (!primed) {
        shown = target;
        primed = true;
      } else {
        shown += (target - shown) * 0.14;
        if (Math.abs(target - shown) < 0.003) shown = target;
      }
      lighting.set({ params: uniforms(canvasSurface.size, state, shown) });
      frame(device, (next) => {
        next.pass(canvasSurface, lighting);
      });
      if (shown !== target) schedule();
    };

    const schedule = () => {
      needsDraw = true;
      if (raf || isDisposed() || !windowActive || document.hidden) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        needsDraw = true;
      } else if (needsDraw) {
        schedule();
      }
    };

    const onWindowBlur = () => {
      windowActive = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      needsDraw = true;
    };
    const onWindowFocus = () => {
      windowActive = true;
      if (needsDraw) schedule();
    };

    canvasSurface.onResize(() => schedule());
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    cleanupListeners = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    };

    // Prime immediately. Waiting for rAF here can retain a WebGPU device
    // indefinitely when the Electron window starts or becomes hidden, because
    // Chromium intentionally suspends hidden-window animation frames.
    draw();
    await Promise.resolve();
    if (isDisposed()) {
      cleanupListeners();
      device.dispose();
      return null;
    }

    schedule();

    return {
      invalidate: schedule,
      dispose() {
        if (raf) cancelAnimationFrame(raf);
        cleanupListeners?.();
        device.dispose();
      },
    };
  } catch (error) {
    console.warn("[vault-light] WebGPU lighting unavailable", error);
    cleanupListeners?.();
    gpu?.dispose();
    return null;
  }
}

function waitForSize(canvas: HTMLCanvasElement, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const ready = () => canvas.clientWidth > 0 && canvas.clientHeight > 0;
    if (ready() || signal.aborted || !canvas.isConnected) {
      resolve();
      return;
    }
    const observer = new ResizeObserver(() => {
      if (ready()) finish();
    });
    const finish = () => {
      observer.disconnect();
      signal.removeEventListener("abort", finish);
      resolve();
    };
    observer.observe(canvas);
    signal.addEventListener("abort", finish, { once: true });
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
