import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

/**
 * Content Security Policy for the renderer. Griffel (Fluent's CSS-in-JS) injects <style> tags,
 * hence 'unsafe-inline' for styles. Development adds what Vite's HMR needs (React Refresh's
 * inline preamble and its WebSocket); the packaged app gets the strict policy.
 */
function contentSecurityPolicy(): Plugin {
  let dev = false;
  return {
    name: "problem-csp",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml() {
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        dev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  main: {
    build: {
      // Bundle everything (zod, the shared package) so the packaged app needs no node_modules.
      externalizeDeps: false,
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react(), contentSecurityPolicy()],
    build: {
      // electron-vite leaves output unminified; the window loads (and parses) less this way.
      minify: true,
      // Fluent and React (~870 kB) load from disk at startup; the web-download default (500 kB)
      // would warn on every build without pointing at anything to fix.
      chunkSizeWarningLimit: 1000,
    },
  },
});
