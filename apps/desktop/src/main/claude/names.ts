/** The app's in-process MCP server and its tool (ADR 0004). Kept SDK-free for the policy. */
export const FINDINGS_SERVER = "problem";
export const REPORT_TOOL = "report_findings";
/** How Claude Code names the tool in hooks and messages. */
export const REPORT_TOOL_NAME = `mcp__${FINDINGS_SERVER}__${REPORT_TOOL}`;
