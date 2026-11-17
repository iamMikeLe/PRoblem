import { fileURLToPath } from "node:url";

/** Where the app's own UI is loaded from: the Vite dev server, or the bundled index.html. */
export type RendererSource = { kind: "dev-server"; url: string } | { kind: "file"; path: string };

/**
 * True when `url` belongs to our own UI. Used to reject IPC from any other frame (an injected
 * iframe, a page the window was navigated to) and to block navigation away from the app.
 */
export function isTrustedRendererUrl(url: string | undefined, source: RendererSource): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (source.kind === "dev-server") return parsed.origin === new URL(source.url).origin;
  return parsed.protocol === "file:" && fileURLToPath(parsed) === source.path;
}
