import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ElectronApplication, _electron as electron, type Page } from "@playwright/test";

export const APP_DIR = join(import.meta.dirname, "..");
export const VIEWPORT = { width: 1440, height: 900 };

/** A repository with `main` and a `feature/discounts` branch that changes one file. */
function makeRepository(root: string): string {
  const repo = join(root, "shop");
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", ...args], {
      cwd: repo,
      stdio: "pipe",
    });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  write(
    "src/cart.ts",
    "export const total = (prices: number[]) =>\n  prices.reduce((a, b) => a + b, 0);\n",
  );
  git("add", ".");
  git("commit", "-q", "-m", "Cart total");
  git("switch", "-q", "-c", "feature/discounts");
  write(
    "src/cart.ts",
    "export const total = (prices: number[], discount = 0) => {\n  const sum = prices.reduce((a, b) => a + b, 0) - discount;\n  return sum * (1 - discount / 100);\n};\n",
  );
  git("commit", "-q", "-am", "Discounts");
  git("switch", "-q", "main");
  return repo;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  /** The repository to add as a project. */
  repo: string;
  /** Deletes the test's folder (repository and app data); call after closing the app. */
  cleanup: () => void;
}

/**
 * The built app with a scripted Claude and its own data folder, away from the user's reviews and
 * from a running dev app.
 */
export async function launchApp(): Promise<LaunchedApp> {
  // realpath: macOS's tmpdir is a symlink, and the app stores resolved paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "problem-e2e-")));
  const repo = makeRepository(root);
  const { ELECTRON_RENDERER_URL: _devServer, ...env } = process.env;
  const app = await electron.launch({
    args: ["."],
    cwd: APP_DIR,
    env: { ...env, PROBLEM_HOME: join(root, "data"), PROBLEM_E2E: "1" },
  });
  const page = await app.firstWindow();
  await page.setViewportSize(VIEWPORT);
  return { app, page, repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
