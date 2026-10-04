import { createServer } from "http";
import { autoUpdater } from "electron-updater";
import log from "electron-log/node";
import { app } from "electron";
import { ELECTRON_COMMANDS } from "../common/electron-commands";
import logit from "./utils/logit";
import openFolder from "./commands/open-folder";
import stop from "./commands/stop";
import selectFolder from "./commands/select-folder";
import selectFile from "./commands/select-file";
import getModelsList from "./commands/get-models-list";
import customModelsSelect from "./commands/custom-models-select";
import imageUpscayl from "./commands/image-upscayl";
import { createMainWindow } from "./main-window";
import electronIsDev from "electron-is-dev";
import { execPath, modelsPath } from "./utils/get-resource-paths";
import batchUpscayl from "./commands/batch-upscayl";
import doubleUpscayl from "./commands/double-upscayl";
import autoUpdate from "./commands/auto-update";
import { FEATURE_FLAGS } from "../common/feature-flags";
import settings from "electron-settings";
import pasteImage from "./commands/paste-image";
import { registerProtocols } from "./protocols";
import { handleIPC, onIPC } from "./ipc";
import { allowFile, hasDirectoryAccess, hasModelAccess } from "./path-access";
import { validateJobPayload } from "./security";
import { getAppVersion, getDeviceSpecs } from "./utils/get-device-specs";
import path from "path";

// INITIALIZATION
log.transports.file.resolvePathFn = () => path.join(app.getPath("userData"), "logs", "main.log");

app.on("ready", async () => {
  if (electronIsDev) {
    const next = require("next")({ dev: true, dir: path.join(app.getAppPath(), "renderer"), webpack: true });
    await next.prepare();
    const server = createServer(next.getRequestHandler());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(8000, "localhost", resolve);
    });
    app.once("before-quit", () => { server.close(); void next.close(); });
  }
  registerProtocols();

  createMainWindow();

  log.info(
    "🆙 Upscayl version:",
    app.getVersion(),
    FEATURE_FLAGS.APP_STORE_BUILD ? "MAC-APP-STORE" : "FOSS",
  );
  log.info("🚀 UPSCAYL EXEC PATH: ", execPath);
  log.info("🚀 MODELS PATH: ", modelsPath);

  let closeAccess;
  const folderBookmarks = await settings.get("folder-bookmarks");
  if (FEATURE_FLAGS.APP_STORE_BUILD && folderBookmarks) {
    logit("🚨 Folder Bookmarks: ", folderBookmarks);
    try {
      closeAccess = app.startAccessingSecurityScopedResource(
        folderBookmarks as string,
      );
    } catch (error) {
      logit("📁 Folder Bookmarks Error: ", error);
    }
  }
});

// Quit the app once all windows are closed
app.on("window-all-closed", () => {
  app.quit();
});

// ! ENABLE THIS FOR MACOS APP STORE BUILD
if (FEATURE_FLAGS.APP_STORE_BUILD) {
  logit("🚀 APP STORE BUILD ENABLED");
  app.commandLine.appendSwitch("in-process-gpu");
}

onIPC(ELECTRON_COMMANDS.STOP, stop);

onIPC("renderer-log", (_event, message) => {
  if (typeof message !== "string") throw new Error("Invalid log message.");
  log.info(message);
});

onIPC(ELECTRON_COMMANDS.OPEN_FOLDER, (event, value) => {
  if (!hasDirectoryAccess(value)) throw new Error("Select the folder first.");
  return openFolder(event, value);
});

handleIPC(ELECTRON_COMMANDS.SELECT_FOLDER, selectFolder);

handleIPC(ELECTRON_COMMANDS.SELECT_FILE, selectFile);

onIPC(ELECTRON_COMMANDS.GET_MODELS_LIST, (event, value) => {
  if (!hasModelAccess(value)) throw new Error("Select the custom models folder first.");
  return getModelsList(event, value);
});

handleIPC(
  ELECTRON_COMMANDS.SELECT_CUSTOM_MODEL_FOLDER,
  customModelsSelect,
);

onIPC(ELECTRON_COMMANDS.UPSCAYL, (event, payload) => {
  validateJobPayload(payload);
  return imageUpscayl(event, payload);
});

onIPC(ELECTRON_COMMANDS.FOLDER_UPSCAYL, (event, payload) => {
  validateJobPayload(payload, true);
  return batchUpscayl(event, payload);
});

onIPC(ELECTRON_COMMANDS.DOUBLE_UPSCAYL, (event, payload) => {
  validateJobPayload(payload);
  return doubleUpscayl(event, payload);
});

onIPC(ELECTRON_COMMANDS.PASTE_IMAGE, pasteImage);

handleIPC("use-dropped-file", (_event, value) => {
  if (typeof value !== "string" || !/\.(png|jpe?g|jfif|webp)$/i.test(value)) throw new Error("Drop a local image file.");
  allowFile(value);
  return value;
});

handleIPC("get-system-info", getDeviceSpecs);
handleIPC("get-app-version", getAppVersion);

if (!FEATURE_FLAGS.APP_STORE_BUILD) {
  autoUpdater.on("update-downloaded", autoUpdate);
}
