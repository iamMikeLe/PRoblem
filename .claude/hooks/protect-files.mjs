// PreToolUse: block edits to files that must never be hand-edited by an agent.
// Exit code 2 blocks the tool call and shows stderr to Claude so it can change course.
import { relative } from "node:path";
import { readHookInput } from "./lib.mjs";

const input = await readHookInput();
const file = input.tool_input?.file_path;
if (typeof file !== "string") process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const path = relative(projectDir, file);

const rules = [
  {
    test: (p) => p.endsWith("pnpm-lock.yaml"),
    why: "Change dependencies with `pnpm add`/`pnpm remove`, never by editing the lockfile.",
  },
  {
    test: (p) => /(^|\/)\.env(\.|$)/.test(p),
    why: "Environment files may hold secrets and are off limits.",
  },
  { test: (p) => p.startsWith(".git/"), why: "Do not touch git internals." },
];

const hit = rules.find((rule) => rule.test(path));
if (hit) {
  console.error(`Blocked edit to ${path}: ${hit.why}`);
  process.exit(2);
}
