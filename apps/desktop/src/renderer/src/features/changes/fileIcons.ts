/**
 * File and folder icons of the Material Icon Theme (VS Code), looked up like VS Code does: the
 * exact file name, then the longest known extension (`spec.ts` before `ts`), then a generic icon.
 *
 * Only the lookup tables this needs are bundled (named JSON imports are tree-shaken). The SVGs are
 * emitted as separate files and referenced by URL, so a window only loads the icons it shows.
 */
import {
  fileExtensions,
  fileNames,
  folderNames,
  light,
} from "material-icon-theme/dist/material-icons.json";

// `?no-inline`: every SVG stays a file next to the bundle (img-src 'self') instead of a data: URL
// inlined into the JavaScript. `base` keeps the map's keys short (`./typescript.svg`).
const ICON_FILES = import.meta.glob<string>("./*.svg", {
  base: "../../../../../node_modules/material-icon-theme/icons",
  query: "?no-inline",
  import: "default",
  eager: true,
});

const ICON_URLS = new Map(
  Object.entries(ICON_FILES).map(([path, url]) => [
    path.slice(path.lastIndexOf("/") + 1, -".svg".length),
    url,
  ]),
);

type Lookup = Readonly<Record<string, string>>;
const DARK = {
  fileNames: fileNames satisfies Lookup,
  fileExtensions: fileExtensions satisfies Lookup,
  folderNames: folderNames satisfies Lookup,
};
const LIGHT = {
  fileNames: light.fileNames satisfies Lookup,
  fileExtensions: light.fileExtensions satisfies Lookup,
  folderNames: light.folderNames satisfies Lookup,
};

export type IconTone = "dark" | "light";

function find(table: "fileNames" | "fileExtensions" | "folderNames", key: string, tone: IconTone) {
  const own = (lookup: Lookup) => (Object.hasOwn(lookup, key) ? lookup[key] : undefined);
  return (tone === "light" ? own(LIGHT[table]) : undefined) ?? own(DARK[table]);
}

/** The icon's name for a file (`typescript`, `nodejs`, …); `file` when nothing matches. */
export function fileIconName(fileName: string, tone: IconTone = "dark"): string {
  const name = fileName.toLowerCase();
  const byName = find("fileNames", name, tone);
  if (byName) return byName;
  // `a.spec.ts`: try `spec.ts`, then `ts`. A leading dot (`.env`) also counts as an extension.
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const byExtension = find("fileExtensions", name.slice(dot + 1), tone);
    if (byExtension) return byExtension;
  }
  return "file";
}

/**
 * The icon's name for a folder, closed or open (`folder-src`, `folder-src-open`). A merged folder
 * (`src/main`) is named after its last part.
 */
export function folderIconName(folderName: string, open: boolean, tone: IconTone = "dark"): string {
  const name = (folderName.split("/").at(-1) ?? folderName).toLowerCase();
  const closed = find("folderNames", name, tone) ?? "folder";
  if (!open) return closed;
  // Open icons are the closed name plus `-open`, before a theme suffix: `folder-x-open_light`.
  const suffix = closed.endsWith("_light") ? "_light" : "";
  const opened = `${closed.slice(0, closed.length - suffix.length)}-open${suffix}`;
  return ICON_URLS.has(opened) ? opened : "folder-open";
}

/** The URL of an icon's SVG; the generic file or folder icon's when the name has no SVG. */
export function iconUrl(
  name: string,
  fallback: "file" | "folder" | "folder-open",
): string | undefined {
  return ICON_URLS.get(name) ?? ICON_URLS.get(fallback);
}
