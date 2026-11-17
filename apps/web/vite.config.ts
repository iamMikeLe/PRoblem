import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const api = `127.0.0.1:${process.env.REVIEWROOM_PORT ?? "4400"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API only trusts this exact origin, so never silently move to another port.
    strictPort: true,
    proxy: {
      "/api/": `http://${api}`,
      "/ws": { target: `ws://${api}`, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
