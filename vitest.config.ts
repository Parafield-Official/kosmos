import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "labs/next/**/*.test.ts", "electron/**/*.test.cjs"],
    globals: true,
  },
});
