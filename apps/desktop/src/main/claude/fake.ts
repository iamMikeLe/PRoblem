import { randomUUID } from "node:crypto";
import { REPORT_TOOL_NAME } from "./names.ts";
import type { ClaudeQuery, RunQuery } from "./sessions.ts";

/** What the scripted reviewer reports on its first turn: one finding about the whole change. */
export const FAKE_FINDING = {
  severity: "major",
  title: "Discount is applied twice",
  problem: "The total subtracts the discount, then applies it again as a percentage.",
  suggestion: "Apply the discount once, after summing the lines.",
  reproduction: "1. Add two items to the cart.\n2. Apply a 10% code.\n3. The total is 19% lower.",
} as const;

/**
 * A scripted stand-in for Claude Code, for the end-to-end test (`PROBLEM_E2E=1`, never in a
 * packaged app). It speaks the SDK message shapes the session service reads: a session, streamed
 * text, a `report_findings` call and a result. Like Claude Code, it asks the app's PreToolUse hook
 * before the call and skips it when denied; the finding is saved through `report`.
 * Follow-up messages get a short echo.
 */
export function fakeClaude(report: (workdir: string, input: unknown) => void): RunQuery {
  return (prompt, options) => {
    const signal = options.abortController?.signal;
    const firstTurn = options.resume === undefined;
    const sessionId = options.resume ?? `fake-${randomUUID()}`;
    const text = firstTurn
      ? "I read the diff. One problem stands out in the discount logic."
      : `You said: ${prompt.slice(0, 200)}`;
    const toolId = `toolu_${randomUUID()}`;
    const input = { add: [FAKE_FINDING] };

    async function allowed(name: string, toolInput: unknown, id: string): Promise<boolean> {
      for (const matcher of options.hooks?.PreToolUse ?? []) {
        for (const hook of matcher.hooks) {
          const output = await hook(
            {
              hook_event_name: "PreToolUse",
              tool_name: name,
              tool_input: toolInput,
              tool_use_id: id,
              session_id: sessionId,
              transcript_path: "",
              cwd: options.cwd ?? "",
            },
            id,
            { signal: signal ?? new AbortController().signal },
          );
          // An async hook output ({ async: true }) carries no decision.
          const specific = "hookSpecificOutput" in output ? output.hookSpecificOutput : undefined;
          if (specific?.hookEventName === "PreToolUse" && specific.permissionDecision === "deny") {
            return false;
          }
        }
      }
      return true;
    }

    async function* messages(): AsyncGenerator<unknown> {
      yield { type: "system", subtype: "init", session_id: sessionId };
      for (const word of text.split(/(?<= )/)) {
        if (signal?.aborted) throw new Error("aborted");
        yield {
          type: "stream_event",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: word },
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      yield {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text }] },
      };
      if (firstTurn) {
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          message: { content: [{ type: "tool_use", id: toolId, name: REPORT_TOOL_NAME, input }] },
        };
        if (await allowed(REPORT_TOOL_NAME, input, toolId)) report(options.cwd ?? "", input);
        yield {
          type: "user",
          parent_tool_use_id: null,
          message: {
            content: [{ type: "tool_result", tool_use_id: toolId, content: "Saved #1." }],
          },
        };
      }
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: text,
        total_cost_usd: 0,
        duration_ms: 100,
      };
    }

    const query: ClaudeQuery = {
      [Symbol.asyncIterator]: messages,
      interrupt: async () => undefined,
      supportedModels: async () => [
        { value: "default", displayName: "Default (recommended)", description: "Scripted" },
      ],
      supportedCommands: async () => [],
    };
    return query;
  };
}
