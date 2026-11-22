// Builds the signed and notarized macOS .dmg (README, "Releasing"). The identity is always named,
// never auto-discovered, and notarization is required: a release that skipped either would not
// open with a double-click on other Macs.
import { execFileSync } from "node:child_process";

const identity = process.env.CSC_NAME?.trim();
const profile = process.env.APPLE_KEYCHAIN_PROFILE?.trim();
if (!identity || !profile) {
  console.error(
    'Set CSC_NAME (the Developer ID Application identity, e.g. "Jane Doe (TEAMID1234)") and ' +
      "APPLE_KEYCHAIN_PROFILE (a profile saved with `xcrun notarytool store-credentials`).",
  );
  process.exit(1);
}

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
run("pnpm", ["exec", "electron-vite", "build"]);
run("pnpm", [
  "exec",
  "electron-builder",
  "--config",
  "electron-builder.yml",
  "--mac",
  "--publish",
  "never",
  `-c.mac.identity=${identity}`,
]);
