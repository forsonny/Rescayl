import { getMainWindow } from "../main-window";
import { childProcesses, clearChildProcesses } from "../utils/config-variables";
import logit from "../utils/logit";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";

const stop = async (event, payload) => {
  const mainWindow = getMainWindow();

  mainWindow && mainWindow.setProgressBar(-1);
  childProcesses.forEach((child) => {
    logit("🛑 Stopping Upscaling Process", child.process.pid);
    child.cancel();
  });
  clearChildProcesses();
  mainWindow?.webContents.send(ELECTRON_COMMANDS.CANCELLED);
};

export default stop;
