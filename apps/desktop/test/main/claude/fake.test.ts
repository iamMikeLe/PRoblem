import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { FAKE_FINDING, fakeClaude } from "../../../src/main/claude/fake.ts";
import { REPORT_TOOL_NAME } from "../../../src/main/claude/names.ts";

async function run(decision: "allow" | "deny", resume?: string) {
  const reports: unknown[] = [];
  const asked: string[] = [];
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name === "PreToolUse") asked.push(input.tool_name);
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision } };
  };
  const options: Options = {
    cwd: "/reviews/r1",
    hooks: { PreToolUse: [{ hooks: [hook] }] },
    ...(resume ? { resume } : {}),
  };
  const messages: unknown[] = [];
  const query = fakeClaude((workdir, input) => reports.push({ workdir, input }))("Go", options);
  for await (const message of query) messages.push(message);
  return { reports, asked, messages };
}

describe("scripted Claude (end-to-end tests)", () => {
  it("asks the app's permission hook before reporting, like Claude Code", async () => {
    const { reports, asked, messages } = await run("allow");
    expect(asked).toEqual([REPORT_TOOL_NAME]);
    expect(reports).toEqual([{ workdir: "/reviews/r1", input: { add: [FAKE_FINDING] } }]);
    expect(messages.at(0)).toMatchObject({ type: "system", subtype: "init" });
    expect(messages.at(-1)).toMatchObject({ type: "result", subtype: "success" });
  });

  it("reports nothing when the hook denies, and only answers on later turns", async () => {
    expect((await run("deny")).reports).toEqual([]);
    const later = await run("allow", "fake-session");
    expect(later.asked).toEqual([]);
    expect(later.messages.at(0)).toMatchObject({ session_id: "fake-session" });
  });
});
