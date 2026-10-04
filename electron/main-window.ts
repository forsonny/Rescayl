import { app, BrowserWindow, shell, session } from "electron";
import { getPlatform } from "./utils/get-device-specs";
import { join } from "path";
import { ELECTRON_COMMANDS } from "../common/electron-commands";
import { fetchLocalStorage } from "./utils/config-variables";
import electronIsDev from "electron-is-dev";
import { autoUpdater } from "electron-updater";
import { canWriteClipboard, contentSecurityPolicy, isSafeExternalURL, isTrustedRendererURL, rendererURL } from "./security";

let mainWindow: BrowserWindow | undefined;

const createMainWindow = () => {
  console.log("📂 DIRNAME", __dirname);
  console.log("🚃 App Path: ", app.getAppPath());

  mainWindow = new BrowserWindow({
    icon: join(__dirname, "build", "icon.png"),
    width: 1300,
    height: 940,
    minHeight: 500,
    minWidth: 600,
    show: false,
    backgroundColor: "#171717",
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, "preload.js"),
    },
    titleBarStyle: getPlatform() === "mac" ? "hiddenInset" : "default",
  });

  const url = rendererURL(electronIsDev);

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(canWriteClipboard(contents, mainWindow?.webContents, permission, details, electronIsDev)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => canWriteClipboard(contents, mainWindow?.webContents, permission, details, electronIsDev));
  if (electronIsDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, ...(isTrustedRendererURL(details.url, true) ? { "Content-Security-Policy": [contentSecurityPolicy(true)] } : {}) } });
    });
  }

  mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalURL(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isTrustedRendererURL(target, electronIsDev)) {
      event.preventDefault();
      if (isSafeExternalURL(target)) void shell.openExternal(target);
    }
  });
  mainWindow.webContents.on("will-redirect", (event, target) => {
    if (!isTrustedRendererURL(target, electronIsDev)) event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) return;
    mainWindow.show();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow) return;
    fetchLocalStorage();

  if (!electronIsDev) {
    console.log("🚀 Checking for updates");
    mainWindow.webContents
      .executeJavaScript('localStorage.getItem("autoUpdate");', true)
      .then((lastSaved: string | null) => {
        if (
          lastSaved === null ||
          lastSaved === undefined ||
          lastSaved === "true"
        ) {
          void autoUpdater.checkForUpdates().catch(error => console.error("Could not check for updates:", error));
        } else {
          console.log("🚀 Auto Update is disabled");
        }
      });
  }

    mainWindow?.webContents.send(ELECTRON_COMMANDS.OS, getPlatform());
  });

  mainWindow.setMenuBarVisibility(false);
};

const getMainWindow = () => {
  return mainWindow;
};

export { createMainWindow, getMainWindow };
