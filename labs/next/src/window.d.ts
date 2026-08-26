export {};

declare global {
  interface Window {
    kosmosNext?: {
      ready: (size: { width: number; height: number }) => void;
      resize: (size: { width: number; height: number }) => Promise<void>;
      setMaterial?: (material: {
        vibrancy?: string;
        visualEffectState?: string;
        blur?: number;
        look?: "frosted" | "transparent";
        clear?: boolean;
      }) => Promise<void>;
      pushTuning?: (values: Record<string, string>) => void;
      jump?: (place: "mark" | "intro" | "brand" | "welcome" | "app") => void;
      onJump?: (callback: (place: "mark" | "intro" | "brand" | "welcome" | "app") => void) => (() => void) | void;
    };
  }
}
