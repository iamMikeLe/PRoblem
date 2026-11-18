import type { AppErrorCode } from "@problem/shared";

/**
 * An expected failure with a stable code for the renderer (bad input, missing project, not a
 * repository). The IPC dispatcher turns it into an `{ ok: false }` result; anything else thrown
 * is logged and reported as `internal`.
 */
export class AppFailure extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppFailure";
    this.code = code;
  }
}

/** The logging surface main-process modules depend on (console in the app, silent in tests). */
export interface Logger {
  info(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { info() {}, error() {} };
