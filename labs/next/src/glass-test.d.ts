export {};

declare global {
  interface Window {
    glassTest?: {
      setMaterial: (material: {
        clear?: boolean;
        vibrancy?: string | null;
        visualEffectState?: string;
      }) => Promise<void>;
    };
  }
}
