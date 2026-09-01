import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Electron production builds load dist/index.html through file://. Relative
  // asset URLs keep that renderer loadable while remaining valid on Vite's
  // localhost development server.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
