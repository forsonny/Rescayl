import { getMainWindow } from "../main-window";
import logit from "../utils/logit";
import fs from "fs";
import path from "path";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import { app, nativeImage } from "electron";
import { allowFile } from "../path-access";

interface IClipboardFileParameters {
  encodedBuffer: string;
}

export const createTempFileFromClipboard = async (
  inputFileParams: IClipboardFileParameters,
): Promise<string> => {
  if (typeof inputFileParams?.encodedBuffer !== "string" || !inputFileParams.encodedBuffer) throw new Error("Invalid clipboard image.");
  const buffer = Buffer.from(inputFileParams.encodedBuffer, "base64");
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error("Invalid clipboard image.");
  const directory = await fs.promises.mkdtemp(path.join(app.getPath("temp"), "upscayl-clipboard-"));
  const tempFilePath = path.join(directory, path.basename(directory) + ".png");
  await fs.promises.writeFile(tempFilePath, image.toPNG(), { flag: "wx" });
  allowFile(tempFilePath);
  app.once("will-quit", () => {
    try { fs.rmSync(directory, { recursive: true, force: true }); }
    catch (error) { console.error("Could not remove the clipboard temporary file:", error); }
  });
  return tempFilePath;
};

const pasteImage = async (
  event: Electron.IpcMainEvent,
  file: IClipboardFileParameters,
) => {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;
    try {
      const imageFilePath = await createTempFileFromClipboard(file);
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_SUCCESS,
        imageFilePath,
      );
    } catch (error: any) {
      logit(error.message);
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_ERROR,
        error.message,
      );
    }
};

export default pasteImage;
