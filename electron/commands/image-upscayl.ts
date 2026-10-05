import fs from "fs";
import { modelsPath } from "../utils/get-resource-paths";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import {
  savedCustomModelsPath,
  setChildProcesses,
  removeChildProcess,
} from "../utils/config-variables";
import { getSingleImageArguments } from "../utils/get-arguments";
import logit from "../utils/logit";
import slash from "../utils/slash";
import { spawnUpscayl } from "../utils/spawn-upscayl";
import { parse } from "path";
import { getMainWindow } from "../main-window";
import { ImageUpscaylPayload } from "../../common/types/types";
import { ImageFormat } from "../types/types";
import showNotification from "../utils/show-notification";
import getFilenameFromPath from "../../common/get-file-name";
import decodePath from "../../common/decode-path";
import getDirectoryFromPath from "../../common/get-directory-from-path";
import { MODELS } from "../../common/models-list";
import { getPlatform } from "../utils/get-device-specs";
import { copyMetadata } from "../utils/copy-metadata";
import { assertOutputAccess } from "../path-access";

const imageUpscayl = async (event, payload: ImageUpscaylPayload) => {
  const mainWindow = getMainWindow();

  if (!mainWindow) {
    logit("No main window found");
    return;
  }

  // GET VARIABLES
  const tileSize = payload.tileSize;
  const compression = payload.compression;
  const ttaMode = payload.ttaMode;
  const scale = payload.scale;
  const useCustomWidth = payload.useCustomWidth;
  const customWidth = useCustomWidth ? payload.customWidth : "";
  const model = payload.model as string;
  const gpuId = payload.gpuId as string;
  const saveImageAs = payload.saveImageAs as ImageFormat;
  const overwrite = payload.overwrite as boolean;
  const imagePath = decodePath(payload.imagePath);
  let inputDir = getDirectoryFromPath(imagePath);
  let outputDir = decodePath(payload.outputPath);
  const fileNameWithExt = getFilenameFromPath(imagePath);
  const fileName = parse(fileNameWithExt).name;

  const outFile =
    outputDir +
    slash +
    fileName +
    "_upscayl_" +
    (useCustomWidth ? `${customWidth}px_` : `${scale}x_`) +
    model +
    "." +
    saveImageAs;

  assertOutputAccess(outFile);
  const isDefaultModel = model in MODELS;

  // Check if filename is too long
  if (outFile.length >= 255) {
    if (getPlatform() === "win") {
      logit("Filename too long for Windows.");
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        "The filename exceeds the maximum path length allowed by Windows. Please shorten the filename or choose a different save location.",
      );
    } else {
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_WARNING,
        "The output filename exceeds 255 characters, which is over the max path length allowed by Windows, though your OS supports it. Please consider shortening the filename next time.",
      );
    }
  }

  // UPSCALE
  if (
    fs.existsSync(outFile) &&
    fs.statSync(outFile).isFile() &&
    fs.statSync(outFile).size > 0 &&
    !overwrite
  ) {
    // If already upscayled, just output that file
    logit("✅ Already upscayled at: ", outFile);
    mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_DONE, outFile);
  } else {
    logit(
      "✅ Upscayl Variables: ",
      JSON.stringify({
        model,
        gpuId,
        saveImageAs,
        inputDir,
        fileNameWithExt,
        outputDir,
        outFile,
        fileName,
        scale,
        compression,
        customWidth,
        useCustomWidth,
        tileSize,
      }),
    );
    const upscayl = spawnUpscayl(
      getSingleImageArguments({
        inputDir,
        fileNameWithExt,
        outFile,
        modelsPath: isDefaultModel
          ? modelsPath
          : (savedCustomModelsPath ?? modelsPath),
        model,
        scale,
        gpuId,
        saveImageAs,
        customWidth,
        compression,
        tileSize,
        ttaMode,
      }),
      logit,
    );

    setChildProcesses(upscayl);

    let failed = false;

    const onData = (data: string) => {
      if (failed || upscayl.isCancelled()) return;
      logit(data.toString());
      mainWindow.setProgressBar(parseFloat(data.slice(0, data.length)) / 100);
      data = data.toString();
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_PROGRESS,
        data.toString(),
      );
      if (data.includes("Error") || data.includes("failed")) {
        onError(data);
      } else if (data.includes("Resizing")) {
        mainWindow.webContents.send(ELECTRON_COMMANDS.SCALING_AND_CONVERTING);
      }
    };
    const onError = (data) => {
      if (failed || upscayl.isCancelled()) return;
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        data.toString(),
      );
      failed = true;
      upscayl.kill();
      return;
    };
    const onClose = async (code: number | null, signal: string | null) => {
      try {
        if (!failed && !upscayl.isCancelled()) {
          if (
            code !== 0 ||
            signal ||
            !fs.existsSync(outFile) ||
            !fs.statSync(outFile).isFile() ||
            fs.statSync(outFile).size === 0
          ) {
            onError(
              `Upscaling failed (exit ${code}, signal ${signal ?? "none"}) or produced no image.`,
            );
            return;
          }
          logit("💯 Done upscaling");
          // Free up memory
          upscayl.kill();
          mainWindow.setProgressBar(-1);
          if (payload.copyMetadata) {
            logit("🏷️ Copying metadata...");
            try {
              await copyMetadata(imagePath, outFile);
              logit("✅ Metadata copied to: ", outFile);
            } catch (error) {
              logit("❌ Error copying metadata: ", error);
              mainWindow.webContents.send(
                ELECTRON_COMMANDS.METADATA_ERROR,
                String(error),
              );
            }
          }
          if (upscayl.isCancelled()) return;
          mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_DONE, outFile);
          showNotification("Upscayl", "Image upscayled successfully!");
        }
      } finally {
        removeChildProcess(upscayl);
      }
    };

    upscayl.process.stderr.on("data", onData);
    upscayl.process.on("error", onError);
    upscayl.process.on("close", onClose);
  }
};

export default imageUpscayl;
