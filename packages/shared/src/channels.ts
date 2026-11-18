/**
 * Names of the IPC channels the renderer may invoke, and of the main → renderer event channel.
 * Kept free of zod so the sandboxed preload script can import it without bundling schemas.
 * `ipc.ts` checks at compile time that this list and the contract have the same keys.
 */
export const IPC_CHANNELS = [
  "projects:list",
  "projects:create",
  "projects:update",
  "projects:remove",
  "projects:branches",
  "reviews:list",
  "reviews:create",
  "reviews:close",
  "reviews:events",
  "reviews:send",
  "reviews:stop",
  "reviews:setFixMode",
  "reviews:checkUpdate",
  "reviews:refresh",
  "changes:files",
  "changes:file",
  "github:conversation",
  "github:preview",
  "github:post",
  "github:open",
  "approvals:list",
  "approvals:decide",
  "claude:catalog",
  "findings:list",
  "findings:counts",
  "findings:setVerdict",
  "settings:get",
  "settings:update",
  "editor:open",
  "dialog:pickFolder",
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

export const EVENT_CHANNEL = "problem:event";

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === "string" && (IPC_CHANNELS as readonly string[]).includes(value);
}
