import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { findExecutable } from "./claude/executable.ts";
import { createSessionService } from "./claude/sessions.ts";
import { dataDir } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { absolutePathOnly, loginShellPath } from "./env.ts";
import type { Logger } from "./errors.ts";
import { createGhClient } from "./git/gh.ts";
import { createDispatcher } from "./ipc/dispatcher.ts";
import { createHandlers } from "./ipc/handlers.ts";
import { broadcast, registerIpc } from "./ipc/register.ts";
import type { RendererSource } from "./ipc/trust.ts";
import { createProjectService } from "./projects/service.ts";
import { createReviewService } from "./reviews/service.ts";
import { createMainWindow } from "./window.ts";

const log: Logger = {
  info: (message, details) => console.info(`[main] ${message}`, details ?? ""),
  error: (message, details) => console.error(`[main] ${message}`, details ?? ""),
};

// One instance only: two processes must not share the database and the worktrees.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();

  // Started from Finder, the app would not find gh, git or claude installed outside /usr/bin.
  if (app.isPackaged && process.platform === "darwin") {
    const path = await loginShellPath();
    if (path) process.env.PATH = path;
  }
  // Never resolve git or gh relative to a review's folder (see absolutePathOnly).
  if (process.platform !== "win32") process.env.PATH = absolutePathOnly(process.env.PATH);

  const home = app.getPath("home");
  const dir = dataDir(process.env, home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(dir, "reviewroom.db"));

  // electron-vite sets ELECTRON_RENDERER_URL while `pnpm dev` runs; packaged builds load the file.
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
  const source: RendererSource = devUrl
    ? { kind: "dev-server", url: devUrl }
    : { kind: "file", path: join(import.meta.dirname, "../renderer/index.html") };
  const preload = join(import.meta.dirname, "../preload/index.cjs");

  const pickFolder = async (): Promise<string | null> => {
    const owner = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Add a project",
      buttonLabel: "Add project",
      properties: ["openDirectory"],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  };

  const projects = createProjectService({ db, home, log });
  const reviews = createReviewService({
    db,
    worktreesDir: join(dir, "worktrees"),
    gh: createGhClient(),
    log,
  });
  const sessions = createSessionService({
    db,
    runQuery: (prompt, options) => query({ prompt, options }),
    broadcast,
    claudePath: () => findExecutable("claude", process.env.PATH),
    log,
  });
  sessions.recover();
  registerIpc(
    ipcMain,
    createDispatcher(createHandlers({ projects, reviews, sessions, pickFolder }), log),
    source,
  );

  let window = createMainWindow(preload, source);

  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createMainWindow(preload, source);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    sessions.shutdown();
    db.close();
  });
}
