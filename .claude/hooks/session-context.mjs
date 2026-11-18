// SessionStart: tell Claude where the project stands, so every session starts on the right phase.
// Whatever this prints to stdout is added to Claude's context.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let roadmap;
try {
  roadmap = readFileSync(join(projectDir, "docs/ROADMAP.md"), "utf8");
} catch {
  process.exit(0); // No roadmap: nothing to add.
}

const phases = roadmap
  .split(/^## /m)
  .slice(1)
  .filter((section) => section.startsWith("Phase"));
const current = phases.find((section) => section.includes("- [ ]"));

if (current) {
  const [title, ...lines] = current.split("\n");
  const open = lines.filter((line) => line.startsWith("- [ ]")).slice(0, 5);
  console.log(`PRoblem roadmap: current phase is "${title}". Next open items:\n${open.join("\n")}`);
} else {
  console.log("PRoblem roadmap: all phases are complete.");
}
