import { type AppEvent, EVENT_CHANNEL, IPC_CHANNELS } from "@problem/shared";
import { BrowserWindow, type IpcMain } from "electron";
import { failure, type IpcDispatch } from "./dispatcher.ts";
import { isTrustedRendererUrl, type RendererSource } from "./trust.ts";

/** Registers one `ipcMain.handle` per contract channel, accepting calls only from our own UI. */
export function registerIpc(ipcMain: IpcMain, dispatch: IpcDispatch, source: RendererSource): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, (event, input: unknown) => {
      if (!isTrustedRendererUrl(event.senderFrame?.url, source)) {
        return failure("untrusted_sender", "IPC is only accepted from the app's own window");
      }
      return dispatch(channel, input);
    });
  }
}

/** Pushes an event to every open window. */
export function broadcast(event: AppEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event);
  }
}
