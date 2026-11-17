import {
  type AppErrorCode,
  type IpcChannel,
  type IpcOutput,
  type IpcParsedInput,
  type IpcResult,
  ipcSchemas,
  isIpcChannel,
} from "@reviewroom/shared";
import type { z } from "zod";
import { AppFailure, type Logger } from "../errors.ts";

/** One implementation per channel; each receives input already validated by the contract. */
export type IpcHandlers = {
  [C in IpcChannel]: (input: IpcParsedInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>>;
};

export type IpcDispatch = (channel: unknown, input: unknown) => Promise<IpcResult<unknown>>;

export const failure = (code: AppErrorCode, message: string): IpcResult<never> => ({
  ok: false,
  error: { code, message },
});

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ` : "") + issue.message)
    .join("; ");
}

/**
 * Routes an IPC call to its handler: rejects unknown channels, validates the input with the
 * channel's schema, and turns every outcome into an `IpcResult`. Expected failures keep their
 * code; unexpected errors are logged here and reach the renderer only as `internal`.
 */
export function createDispatcher(handlers: IpcHandlers, log: Logger): IpcDispatch {
  async function run<C extends IpcChannel>(channel: C, raw: unknown): Promise<IpcResult<unknown>> {
    const parsed = ipcSchemas[channel].input.safeParse(raw);
    if (!parsed.success) return failure("invalid_request", describeIssues(parsed.error));
    const handler: IpcHandlers[C] = handlers[channel];
    try {
      return { ok: true, data: await handler(parsed.data) };
    } catch (error) {
      if (error instanceof AppFailure) return failure(error.code, error.message);
      log.error("ipc handler failed", { channel, error });
      return failure("internal", "Something went wrong in the app");
    }
  }

  return async (channel, raw) => {
    if (!isIpcChannel(channel))
      return failure("unknown_channel", `Unknown channel ${String(channel)}`);
    return run(channel, raw);
  };
}
