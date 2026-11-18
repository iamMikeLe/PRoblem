import { BrowserWindow, shell } from "electron";
import { isTrustedRendererUrl, type RendererSource } from "./ipc/trust.ts";

/** Teams dark background, so the window does not flash white before React paints. */
const BACKGROUND = "#1f1f1f";
const TITLE_BAR_HEIGHT = 48;

export function createMainWindow(preload: string, source: RendererSource): BrowserWindow {
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "PRoblem",
    backgroundColor: BACKGROUND,
    // Our Teams-style title bar is the window's title bar: hide the native one.
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {
          titleBarOverlay: { color: "#00000000", symbolColor: "#ffffff", height: TITLE_BAR_HEIGHT },
        }),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // Never open other windows; send web links to the default browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Never navigate the app window away from the app.
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, source)) event.preventDefault();
  });

  if (source.kind === "dev-server") void window.loadURL(source.url);
  else void window.loadFile(source.path);
  return window;
}
