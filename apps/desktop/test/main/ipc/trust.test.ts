import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "../../../src/main/ipc/trust.ts";

describe("isTrustedRendererUrl", () => {
  const dev = { kind: "dev-server", url: "http://localhost:5173/" } as const;
  const file = {
    kind: "file",
    path: "/Applications/ReviewRoom.app/out/renderer/index.html",
  } as const;

  it("trusts the dev server's origin, any path", () => {
    expect(isTrustedRendererUrl("http://localhost:5173/", dev)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173/src/main.tsx", dev)).toBe(true);
  });

  it("rejects other origins and ports in development", () => {
    expect(isTrustedRendererUrl("http://localhost:5174/", dev)).toBe(false);
    expect(isTrustedRendererUrl("https://evil.example/", dev)).toBe(false);
  });

  it("trusts only the bundled index.html in production", () => {
    expect(isTrustedRendererUrl(`file://${file.path}`, file)).toBe(true);
    expect(isTrustedRendererUrl(`file://${file.path}#/projects`, file)).toBe(true);
    expect(isTrustedRendererUrl("file:///tmp/evil.html", file)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173/", file)).toBe(false);
  });

  it("rejects missing and malformed URLs", () => {
    expect(isTrustedRendererUrl(undefined, dev)).toBe(false);
    expect(isTrustedRendererUrl("", dev)).toBe(false);
    expect(isTrustedRendererUrl("not a url", dev)).toBe(false);
  });
});
