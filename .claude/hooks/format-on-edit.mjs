// PostToolUse: format the file Claude just wrote, so diffs stay clean and lint never fails on style.
import { spawnSync } from "node:child_process";
import { readHookInput } from "./lib.mjs";

const input = await readHookInput();
const file = input.tool_input?.file_path;
if (typeof file !== "string" || !/\.(ts|tsx|js|mjs|json|css)$/.test(file)) process.exit(0);
if (file.includes("node_modules")) process.exit(0);

const result = spawnSync(
  "pnpm",
  ["exec", "biome", "check", "--write", "--no-errors-on-unmatched", file],
  { cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), encoding: "utf8" },
);

// Remaining lint errors are reported back to Claude (exit 2 on PostToolUse = feedback, not a block).
if (result.status !== 0) {
  console.error(`Biome reported problems in ${file}:\n${result.stdout}${result.stderr}`);
  process.exit(2);
}
