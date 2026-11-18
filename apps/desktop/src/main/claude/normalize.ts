import { isAbsolute, relative } from "node:path";
import { type ConversationEntry, TOOL_TEXT_MAX } from "@reviewroom/shared";
import { z } from "zod";
import { REPORT_TOOL_NAME } from "./names.ts";

/**
 * Turns Claude Agent SDK messages into what the app stores and shows. The SDK's message types are
 * large and change often, so each shape we use is validated here with a narrow zod schema; any
 * other message is ignored. Only top-level messages count: subagent frames carry a
 * `parent_tool_use_id` (and subagents are not enabled in reviews anyway).
 */
export type SdkSignal =
  | { type: "session"; sessionId: string }
  | { type: "entry"; entry: ConversationEntry }
  | { type: "delta"; text: string };

const TopLevel = { parent_tool_use_id: z.null().optional() };

const InitSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  session_id: z.string().min(1),
});

const TextBlock = z.object({ type: z.literal("text"), text: z.string() });
const ToolUseBlock = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});
const AssistantSchema = z.object({
  type: z.literal("assistant"),
  ...TopLevel,
  message: z.object({ content: z.array(z.unknown()) }),
});

const ToolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  is_error: z.boolean().optional(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
});
const UserSchema = z.object({
  type: z.literal("user"),
  ...TopLevel,
  message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }),
});

const DeltaSchema = z.object({
  type: z.literal("stream_event"),
  ...TopLevel,
  event: z.object({
    type: z.literal("content_block_delta"),
    delta: z.object({ type: z.literal("text_delta"), text: z.string() }),
  }),
});

const ResultSchema = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  errors: z.array(z.string()).optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
});

export function truncate(text: string, max = TOOL_TEXT_MAX): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n… (${text.length - max} more characters)`;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** One line describing a tool call, e.g. `src/app.ts` for Read or the command for Bash. */
export function summarizeToolCall(name: string, input: unknown, cwd: string): string {
  const args = asRecord(input);
  const shortPath = (path: string) => {
    if (!isAbsolute(path)) return path;
    const rel = relative(cwd, path);
    return rel === "" ? "." : rel.startsWith("..") ? path : rel;
  };
  switch (name) {
    case "Read": {
      const path = str(args.file_path);
      return path ? shortPath(path) : name;
    }
    case "Grep": {
      const pattern = str(args.pattern) ?? "";
      const path = str(args.path);
      return path ? `${pattern} in ${shortPath(path)}` : pattern;
    }
    case "Glob":
      return str(args.pattern) ?? name;
    case "Edit":
    case "Write": {
      const path = str(args.file_path);
      return path ? shortPath(path) : name;
    }
    case "WebFetch":
      return str(args.url) ?? name;
    case "WebSearch":
      return str(args.query) ?? name;
    case "Bash":
      return str(args.command)?.split("\n")[0] ?? name;
    case REPORT_TOOL_NAME: {
      const count = (key: string) => (Array.isArray(args[key]) ? args[key].length : 0);
      const parts = [
        [count("add"), "new"],
        [count("update"), "updated"],
        [count("withdraw"), "withdrawn"],
      ]
        .filter(([n]) => n !== 0)
        .map(([n, word]) => `${n} ${word}`);
      return `Findings: ${parts.length > 0 ? parts.join(", ") : "none"}`;
    }
    default:
      return name;
  }
}

function resultText(content: string | unknown[] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      const text = TextBlock.safeParse(block);
      return text.success ? text.data.text : "[non-text content]";
    })
    .join("\n");
}

function resultEntry(message: z.infer<typeof ResultSchema>): ConversationEntry {
  const failed = message.subtype !== "success" || message.is_error === true;
  const reason = message.errors?.join("\n") || (failed ? message.result : undefined);
  return {
    kind: "turn-end",
    outcome: failed ? "error" : "success",
    costUsd: message.total_cost_usd ?? null,
    durationMs: message.duration_ms ?? null,
    message: failed ? (reason ?? `Claude stopped (${message.subtype})`) : null,
  };
}

/** The signals one SDK message produces, in order (usually zero or one). */
export function toSignals(message: unknown, cwd: string): SdkSignal[] {
  const init = InitSchema.safeParse(message);
  if (init.success) return [{ type: "session", sessionId: init.data.session_id }];

  const delta = DeltaSchema.safeParse(message);
  if (delta.success) return [{ type: "delta", text: delta.data.event.delta.text }];

  const assistant = AssistantSchema.safeParse(message);
  if (assistant.success) {
    const signals: SdkSignal[] = [];
    for (const block of assistant.data.message.content) {
      const text = TextBlock.safeParse(block);
      if (text.success && text.data.text.trim() !== "") {
        signals.push({ type: "entry", entry: { kind: "assistant", text: text.data.text } });
        continue;
      }
      const tool = ToolUseBlock.safeParse(block);
      if (tool.success) {
        signals.push({
          type: "entry",
          entry: {
            kind: "tool-call",
            toolUseId: tool.data.id,
            name: tool.data.name,
            summary: truncate(summarizeToolCall(tool.data.name, tool.data.input, cwd), 300),
            input: truncate(JSON.stringify(tool.data.input ?? {}, null, 2)),
          },
        });
      }
    }
    return signals;
  }

  const user = UserSchema.safeParse(message);
  if (user.success) {
    // The prompt itself is stored when the user sends it; only tool results matter here.
    const content = user.data.message.content;
    if (typeof content === "string") return [];
    const signals: SdkSignal[] = [];
    for (const block of content) {
      const result = ToolResultBlock.safeParse(block);
      if (!result.success) continue;
      signals.push({
        type: "entry",
        entry: {
          kind: "tool-result",
          toolUseId: result.data.tool_use_id,
          isError: result.data.is_error ?? false,
          output: truncate(resultText(result.data.content)),
        },
      });
    }
    return signals;
  }

  const result = ResultSchema.safeParse(message);
  if (result.success) return [{ type: "entry", entry: resultEntry(result.data) }];

  return [];
}
