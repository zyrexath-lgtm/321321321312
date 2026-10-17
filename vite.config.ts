import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Discover the worker's XML dependency at startup, so the first upload
  // cannot trigger dependency optimisation and a development-page reload.
  optimizeDeps: { include: ["@xmldom/xmldom", "fflate"] },
  worker: { format: "es" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
