import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { editorTemplate } from "@problem/shared";
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";
import { createChangesService } from "./changes/service.ts";
import { findExecutable } from "./claude/executable.ts";
import { fakeClaude } from "./claude/fake.ts";
import { createSessionService } from "./claude/sessions.ts";
import { DATABASE_NAME, dataDir } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { createEditorOpener, spawnDetached } from "./editor/open.ts";
import { absolutePathOnly, loginShellPath } from "./env.ts";
import type { Logger } from "./errors.ts";
import { createFindingsService } from "./findings/service.ts";
import { createGhClient } from "./git/gh.ts";
import { repairWorktree } from "./git/worktree.ts";
import { createGitHubService } from "./github/service.ts";
import { createDispatcher } from "./ipc/dispatcher.ts";
import { createHandlers } from "./ipc/handlers.ts";
import { broadcast, registerIpc } from "./ipc/register.ts";
import type { RendererSource } from "./ipc/trust.ts";
import { migrateLegacyDataDir, moveFolder, relocateReviews } from "./legacy.ts";
import { createProjectService } from "./projects/service.ts";
import { createReviewService } from "./reviews/service.ts";
import { createSearchService } from "./search/service.ts";
import { getSettings, updateSettings } from "./settings/repository.ts";
import { createMainWindow } from "./window.ts";

const log: Logger = {
  info: (message, details) => console.info(`[main] ${message}`, details ?? ""),
  error: (message, details) => console.error(`[main] ${message}`, details ?? ""),
};

// The end-to-end test: a scripted Claude, and Electron's own data (local storage, the
// single-instance lock) beside the test's PROBLEM_HOME, away from the user's app. Never packaged.
const e2e = !app.isPackaged && process.env.PROBLEM_E2E === "1";
if (e2e) app.setPath("userData", join(dataDir(process.env, app.getPath("home")), "electron"));

// Formerly ReviewRoom: keep the UI preferences (local storage) of the old app folder, once.
// Electron creates the new folder itself at startup, but its local storage only with the window.
if (app.getPath("userData") === join(app.getPath("appData"), "PRoblem")) {
  moveFolder(
    join(app.getPath("appData"), "ReviewRoom", "Local Storage"),
    join(app.getPath("userData"), "Local Storage"),
  );
}

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
  const legacyDir = migrateLegacyDataDir(process.env, home, dir, DATABASE_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(dir, DATABASE_NAME));
  if (legacyDir) {
    log.info("moved the ReviewRoom data folder", { from: legacyDir, to: dir });
    await relocateReviews(db, legacyDir, dir, repairWorktree, log);
  }

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
  const gh = createGhClient();
  const reviews = createReviewService({
    db,
    worktreesDir: join(dir, "worktrees"),
    gh,
    log,
  });
  const findings = createFindingsService({ db, broadcast });
  const changes = createChangesService({ review: (id) => reviews.get(id) });
  const github = createGitHubService({ db, gh, review: (id) => reviews.get(id), changes, log });
  const search = createSearchService({ db, changes, log });
  const settings = {
    get: () => getSettings(db),
    update: (request: Parameters<typeof updateSettings>[1]) => updateSettings(db, request),
  };
  const editor = createEditorOpener({
    template: () => editorTemplate(getSettings(db)),
    workdirOf: (id) => reviews.get(id).workdir,
    path: () => process.env.PATH,
    home,
    launch: spawnDetached,
  });
  const sessions = createSessionService({
    db,
    runQuery: e2e
      ? fakeClaude((workdir, input) => {
          const review = reviews.list().find((open) => open.workdir === workdir);
          if (review) findings.report(review.id, workdir, input);
        })
      : (prompt, options) => query({ prompt, options }),
    broadcast,
    findings,
    claudePath: () => (e2e ? "scripted" : findExecutable("claude", process.env.PATH)),
    log,
    // A review waits for an approval: tell the user if they are looking elsewhere (ADR 0012).
    notify: (approval, reviewTitle) => {
      if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
      const notification = new Notification({
        title: `${reviewTitle} needs your approval`,
        // Not the request itself: that text comes from Claude and is shown in full on the card.
        body: `Claude wants to use ${approval.toolName}.`,
      });
      notification.on("click", () => {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        broadcast({ type: "app.showReview", reviewId: approval.reviewId });
      });
      notification.show();
    },
    attention: (waiting) => app.setBadgeCount(waiting),
    commentsNote: (id) => github.commentsNote(id),
    afterTurn: (id) => github.refreshInBackground(id),
  });
  sessions.recover();
  registerIpc(
    ipcMain,
    createDispatcher(
      createHandlers({
        projects,
        reviews,
        sessions,
        findings,
        changes,
        github,
        search,
        log,
        openExternal: (url) => shell.openExternal(url),
        settings,
        editor,
        pickFolder,
      }),
      log,
    ),
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
