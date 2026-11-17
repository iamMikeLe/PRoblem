import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "main",
          environment: "node",
          include: ["test/main/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["test/renderer/**/*.test.{ts,tsx}"],
          setupFiles: ["test/renderer/setup.ts"],
        },
      },
    ],
  },
});
