import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), wgslVitePlugin()],
  root,
  appType: "mpa",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        debug: resolve(root, "debug.html"),
      },
    },
  },
});
