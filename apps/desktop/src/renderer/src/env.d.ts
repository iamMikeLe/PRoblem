import type { ReviewRoomBridge } from "@reviewroom/shared";

declare global {
  interface Window {
    /** Exposed by the preload script (`src/preload/index.ts`). Absent outside Electron. */
    readonly reviewroom?: ReviewRoomBridge;
  }
}
