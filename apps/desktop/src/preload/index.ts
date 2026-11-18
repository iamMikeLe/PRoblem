import type { AppEvent, ProblemBridge } from "@problem/shared";
import { EVENT_CHANNEL, isIpcChannel } from "@problem/shared/channels";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

/**
 * The only door between the sandboxed UI and the main process. It exposes a single generic
 * `invoke` limited to the contract's channels, never `ipcRenderer` itself.
 */
const bridge: ProblemBridge = {
  invoke: (channel, input) => {
    if (!isIpcChannel(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`));
    return ipcRenderer.invoke(channel, input);
  },
  onEvent: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: AppEvent) => listener(payload);
    ipcRenderer.on(EVENT_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, wrapped);
    };
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld("problem", bridge);
