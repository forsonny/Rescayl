import { ipcMain } from "electron";
import electronIsDev from "electron-is-dev";
import { ELECTRON_COMMANDS } from "../common/electron-commands";
import { getMainWindow } from "./main-window";
import { isTrustedRendererURL } from "./security";

export const isTrustedSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
  const window = getMainWindow();
  return !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && !!event.senderFrame && isTrustedRendererURL(event.senderFrame.url, electronIsDev);
};

export const handleIPC = (command: string, handler: (...args: any[]) => any) => {
  ipcMain.handle(command, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted IPC sender.");
    return handler(event, ...args);
  });
};

export const onIPC = (command: string, handler: (...args: any[]) => any) => {
  ipcMain.on(command, async (event, ...args) => {
    if (!isTrustedSender(event)) return;
    try { await handler(event, ...args); }
    catch (error) { event.sender.send(ELECTRON_COMMANDS.UPSCAYL_ERROR, error instanceof Error ? error.message : "Could not complete the request."); }
  });
};
