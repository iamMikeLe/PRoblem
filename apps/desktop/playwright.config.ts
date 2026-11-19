import { defineConfig } from "@playwright/test";

/** End-to-end tests drive the built app (`pnpm e2e` builds first) with a scripted Claude. */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One Electron app at a time: each test starts its own, with its own data folder.
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
});
