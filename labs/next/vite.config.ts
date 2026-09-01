import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig, type Plugin } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const cmudict = resolve(root, "../../vendor/cmudict/cmudict.dict");

function cmudictPlugin(): Plugin {
  return {
    name: "cmudict",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/cmudict.dict") {
          next();
          return;
        }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(readFileSync(cmudict));
      });
    },
  };
}

export default defineConfig({
  // Installed Electron builds load the Lightbox renderer through file://.
  base: "./",
  plugins: [react(), wgslVitePlugin(), cmudictPlugin()],
  root,
  appType: "mpa",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  build: {
    // The installer packages root dist/, so this replaces the legacy renderer
    // with the Lightbox renderer for both macOS and Windows.
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        debug: resolve(root, "debug.html"),
      },
    },
  },
});
