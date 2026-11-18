import type { ProblemBridge } from "@problem/shared";

declare global {
  interface Window {
    /** Exposed by the preload script (`src/preload/index.ts`). Absent outside Electron. */
    readonly problem?: ProblemBridge;
  }
}
