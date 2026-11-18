import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { REPORT_TOOL_DESCRIPTION, type ReportOutcome, ReportShape } from "../findings/report.ts";
import { FINDINGS_SERVER, REPORT_TOOL } from "./names.ts";

/** The `report_findings` tool, bound to one review through `report`. */
export function reportFindingsTool(report: (input: unknown) => ReportOutcome) {
  return tool(
    REPORT_TOOL,
    REPORT_TOOL_DESCRIPTION,
    ReportShape,
    async (input) => {
      const outcome = report(input);
      return { content: [{ type: "text", text: outcome.text }], isError: !outcome.ok };
    },
    { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  );
}

/** The in-process MCP server a review turn gets (`mcp__problem__report_findings`). */
export function findingsServer(
  report: (input: unknown) => ReportOutcome,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: FINDINGS_SERVER,
    version: "1.0.0",
    tools: [reportFindingsTool(report)],
  });
}
