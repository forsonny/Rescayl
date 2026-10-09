import { ipcRenderer, contextBridge, webUtils } from "electron";
import { ELECTRON_COMMANDS as commands } from "../common/electron-commands";
import type { DesktopAPI } from "../common/electron-api";

const subscribe = <T>(command: string, listener: (data: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => listener(data);
  ipcRenderer.on(command, handler);
  return () => ipcRenderer.removeListener(command, handler);
};

const api: DesktopAPI = {
  platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux",
  selectImage: () => ipcRenderer.invoke(commands.SELECT_FILE),
  selectFolder: () => ipcRenderer.invoke(commands.SELECT_FOLDER),
  selectCustomModels: () => ipcRenderer.invoke(commands.SELECT_CUSTOM_MODEL_FOLDER),
  loadDroppedFile: (file) => ipcRenderer.invoke("use-dropped-file", webUtils.getPathForFile(file)),
  upscale: (payload) => ipcRenderer.send(commands.UPSCAYL, payload),
  upscaleBatch: (payload) => ipcRenderer.send(commands.FOLDER_UPSCAYL, payload),
  upscaleDouble: (payload) => ipcRenderer.send(commands.DOUBLE_UPSCAYL, payload),
  stop: () => ipcRenderer.send(commands.STOP),
  openFolder: (path) => ipcRenderer.send(commands.OPEN_FOLDER, path),
  loadModels: (path) => ipcRenderer.send(commands.GET_MODELS_LIST, path),
  pasteImage: (encodedBuffer) => ipcRenderer.send(commands.PASTE_IMAGE, { encodedBuffer }),
  writeLog: (message) => ipcRenderer.send("renderer-log", message),
  getSystemInfo: () => ipcRenderer.invoke("get-system-info"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getMosrGpus: () => ipcRenderer.invoke("get-mosr-gpus"),
  onLog: (listener) => subscribe(commands.LOG, listener),
  onFinishing: (listener) => subscribe(commands.SCALING_AND_CONVERTING, listener),
  onWarning: (listener) => subscribe(commands.UPSCAYL_WARNING, listener),
  onError: (listener) => subscribe(commands.UPSCAYL_ERROR, listener),
  onMetadataError: (listener) => subscribe(commands.METADATA_ERROR, listener),
  onProgress: (listener) => subscribe(commands.UPSCAYL_PROGRESS, listener),
  onBatchProgress: (listener) => subscribe(commands.FOLDER_UPSCAYL_PROGRESS, listener),
  onDoubleProgress: (listener) => subscribe(commands.DOUBLE_UPSCAYL_PROGRESS, listener),
  onDone: (listener) => subscribe(commands.UPSCAYL_DONE, listener),
  onBatchDone: (listener) => subscribe(commands.FOLDER_UPSCAYL_DONE, listener),
  onDoubleDone: (listener) => subscribe(commands.DOUBLE_UPSCAYL_DONE, listener),
  onModels: (listener) => subscribe(commands.CUSTOM_MODEL_FILES_LIST, listener),
  onPasteSuccess: (listener) => subscribe(commands.PASTE_IMAGE_SAVE_SUCCESS, listener),
  onPasteError: (listener) => subscribe(commands.PASTE_IMAGE_SAVE_ERROR, listener),
  onCancelled: (listener) => subscribe(commands.CANCELLED, listener),
};

contextBridge.exposeInMainWorld("electron", api);
