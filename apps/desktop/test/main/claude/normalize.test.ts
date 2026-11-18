import { describe, expect, it } from "vitest";
import { summarizeToolCall, toSignals, truncate } from "../../../src/main/claude/normalize.ts";

const CWD = "/work/review";

describe("SDK message normalization", () => {
  it("takes the session id from the init message", () => {
    expect(
      toSignals({ type: "system", subtype: "init", session_id: "abc", model: "x" }, CWD),
    ).toEqual([{ type: "session", sessionId: "abc" }]);
  });

  it("turns text and tool calls into entries, skipping thinking and empty text", () => {
    const signals = toSignals(
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: "  " },
            { type: "text", text: "Found it." },
            {
              type: "tool_use",
              id: "t1",
              name: "Read",
              input: { file_path: "/work/review/src/a.ts" },
            },
          ],
        },
      },
      CWD,
    );
    expect(signals).toEqual([
      { type: "entry", entry: { kind: "assistant", text: "Found it." } },
      {
        type: "entry",
        entry: {
          kind: "tool-call",
          toolUseId: "t1",
          name: "Read",
          summary: "src/a.ts",
          input: JSON.stringify({ file_path: "/work/review/src/a.ts" }, null, 2),
        },
      },
    ]);
  });

  it("turns tool results into entries and ignores the echoed prompt", () => {
    expect(
      toSignals(
        {
          type: "user",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                is_error: true,
                content: [{ type: "text", text: "denied" }, { type: "image" }],
              },
            ],
          },
        },
        CWD,
      ),
    ).toEqual([
      {
        type: "entry",
        entry: {
          kind: "tool-result",
          toolUseId: "t1",
          isError: true,
          output: "denied\n[non-text content]",
        },
      },
    ]);
    expect(toSignals({ type: "user", message: { content: "Review it." } }, CWD)).toEqual([]);
  });

  it("passes text deltas through for live display", () => {
    expect(
      toSignals(
        {
          type: "stream_event",
          parent_tool_use_id: null,
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
        },
        CWD,
      ),
    ).toEqual([{ type: "delta", text: "Hel" }]);
  });

  it("ignores subagent frames and unknown messages", () => {
    expect(
      toSignals(
        {
          type: "assistant",
          parent_tool_use_id: "t9",
          message: { content: [{ type: "text", text: "x" }] },
        },
        CWD,
      ),
    ).toEqual([]);
    expect(toSignals({ type: "rate_limit_event" }, CWD)).toEqual([]);
    expect(toSignals("garbage", CWD)).toEqual([]);
  });

  it("maps results to turn ends", () => {
    expect(
      toSignals(
        {
          type: "result",
          subtype: "success",
          is_error: false,
          total_cost_usd: 0.1,
          duration_ms: 900,
        },
        CWD,
      ),
    ).toEqual([
      {
        type: "entry",
        entry: {
          kind: "turn-end",
          outcome: "success",
          costUsd: 0.1,
          durationMs: 900,
          message: null,
        },
      },
    ]);
    expect(
      toSignals(
        { type: "result", subtype: "success", is_error: true, result: "API Error: 529" },
        CWD,
      ),
    ).toEqual([
      {
        type: "entry",
        entry: {
          kind: "turn-end",
          outcome: "error",
          costUsd: null,
          durationMs: null,
          message: "API Error: 529",
        },
      },
    ]);
  });

  it("summarizes tool calls in one line", () => {
    expect(summarizeToolCall("Grep", { pattern: "retry", path: "/work/review/src" }, CWD)).toBe(
      "retry in src",
    );
    expect(summarizeToolCall("Bash", { command: "git log\n--stat" }, CWD)).toBe("git log");
    expect(summarizeToolCall("Edit", { file_path: "/work/review/src/a.ts" }, CWD)).toBe("src/a.ts");
    expect(summarizeToolCall("Write", { file_path: "/etc/x" }, CWD)).toBe("/etc/x");
    expect(summarizeToolCall("WebFetch", { url: "https://example.com/?q=1" }, CWD)).toBe(
      "https://example.com/?q=1",
    );
    expect(summarizeToolCall("WebSearch", { query: "retry backoff" }, CWD)).toBe("retry backoff");
    const report = "mcp__problem__report_findings";
    expect(summarizeToolCall(report, { add: [{}, {}], withdraw: [{}] }, CWD)).toBe(
      "Findings: 2 new, 1 withdrawn",
    );
    expect(summarizeToolCall(report, {}, CWD)).toBe("Findings: none");
    expect(summarizeToolCall("Read", { file_path: "/etc/hosts" }, CWD)).toBe("/etc/hosts");
    expect(summarizeToolCall("Mystery", {}, CWD)).toBe("Mystery");
  });

  it("truncates long tool output", () => {
    expect(truncate("abcdef", 3)).toBe("abc\n… (3 more characters)");
    expect(truncate("abc", 3)).toBe("abc");
  });
});
