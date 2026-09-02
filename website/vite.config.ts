import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  publicDir: resolve(root, "../site/assets"),
  build: {
    outDir: resolve(root, "../website-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(root, "index.html"),
        about: resolve(root, "about/index.html"),
        features: resolve(root, "features/index.html"),
        workflow: resolve(root, "workflow/index.html"),
        faq: resolve(root, "faq/index.html"),
        download: resolve(root, "download/index.html"),
      },
    },
  },
});
