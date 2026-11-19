import { describe, expect, it } from "vitest";
import {
  fileIconName,
  folderIconName,
  iconUrl,
} from "../../../../src/renderer/src/features/changes/fileIcons.ts";

describe("file icons", () => {
  it("finds a file's icon by name, then by its longest extension", () => {
    expect(fileIconName("cart.ts")).toBe("typescript");
    expect(fileIconName("Cart.TS")).toBe("typescript");
    expect(fileIconName("cart.spec.ts")).toBe("test-ts");
    expect(fileIconName("package.json")).toBe("nodejs");
    expect(fileIconName("tsconfig.json")).toBe("tsconfig");
    expect(fileIconName("settings.json")).toBe("json");
    expect(fileIconName("README.md")).toBe("readme");
    expect(fileIconName("theme.css")).toBe("css");
  });

  it("falls back to the generic file icon", () => {
    expect(fileIconName("notes.unknownext")).toBe("file");
    expect(fileIconName("NOEXTENSION")).toBe("file");
    expect(fileIconName("constructor")).toBe("file");
    expect(fileIconName("x.__proto__")).toBe("file");
  });

  it("uses the light theme's variants where there are some", () => {
    expect(fileIconName("pnpm-lock.yaml", "dark")).toBe("pnpm");
    expect(fileIconName("pnpm-lock.yaml", "light")).toBe("pnpm_light");
    expect(fileIconName("cart.ts", "light")).toBe("typescript");
  });

  it("finds folder icons, closed and open, by the last part of a merged folder", () => {
    expect(folderIconName("src", false)).toBe("folder-src");
    expect(folderIconName("src", true)).toBe("folder-src-open");
    expect(folderIconName("apps/desktop/test", true)).toBe("folder-test-open");
    expect(folderIconName("whatever-xyz", false)).toBe("folder");
    expect(folderIconName("whatever-xyz", true)).toBe("folder-open");
    expect(folderIconName(".idea", true, "light")).toBe("folder-intellij-open_light");
  });

  it("has an SVG for every icon it names, and the generic one for unknown names", () => {
    for (const name of ["typescript", "folder-src-open", "pnpm_light", "file", "folder-open"]) {
      expect(iconUrl(name, "file")).toMatch(/\.svg/);
    }
    expect(iconUrl("no-such-icon", "file")).toBe(iconUrl("file", "file"));
    expect(iconUrl("no-such-icon", "folder")).toBe(iconUrl("folder", "folder"));
  });
});
