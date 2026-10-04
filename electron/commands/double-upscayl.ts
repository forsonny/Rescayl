import fs from "fs";
import path from "path";
import { getMainWindow } from "../main-window";
import {
  savedCustomModelsPath,
  setChildProcesses,
  removeChildProcess,
} from "../utils/config-variables";
import { spawnUpscayl } from "../utils/spawn-upscayl";
import {
  getDoubleUpscaleArguments,
  getDoubleUpscaleSecondPassArguments,
} from "../utils/get-arguments";
import { modelsPath } from "../utils/get-resource-paths";
import logit from "../utils/logit";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import { DoubleUpscaylPayload } from "../../common/types/types";
import { ImageFormat } from "../types/types";
import showNotification from "../utils/show-notification";
import { MODELS } from "../../common/models-list";
import { copyMetadata } from "../utils/copy-metadata";
import { assertOutputAccess } from "../path-access";

const doubleUpscayl = async (_event, payload: DoubleUpscaylPayload) => {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;
  const {
    imagePath,
    outputPath,
    model,
    scale,
    gpuId,
    compression,
    tileSize,
    ttaMode,
  } = payload;
  const customWidth = payload.useCustomWidth ? payload.customWidth : "";
  const saveImageAs = payload.saveImageAs as ImageFormat;
  const outFile = path.join(
    outputPath,
    `${path.parse(imagePath).name}_upscayl_double_${customWidth ? `${customWidth}px` : `${scale}x`}_${model}.${saveImageAs}`,
  );
  assertOutputAccess(outFile);
  if (fs.existsSync(outFile) && !payload.overwrite) {
    mainWindow.webContents.send(ELECTRON_COMMANDS.DOUBLE_UPSCAYL_DONE, outFile);
    return;
  }
  const temporaryDir = fs.mkdtempSync(
    path.join(outputPath, ".upscayl-double-"),
  );
  const intermediate = path.join(temporaryDir, `first.${saveImageAs}`);
  const result = path.join(temporaryDir, `result.${saveImageAs}`);
  const modelDirectory = Object.prototype.hasOwnProperty.call(MODELS, model)
    ? modelsPath
    : (savedCustomModelsPath ?? modelsPath);
  const cleanup = () => {
    if (
      path.dirname(path.resolve(temporaryDir)) !== path.resolve(outputPath) ||
      !path.basename(temporaryDir).startsWith(".upscayl-double-")
    )
      throw Error("Invalid temporary directory");
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  };
  const runPass = (
    args: string[],
    destination: string,
    finished: (child: ReturnType<typeof spawnUpscayl>) => Promise<void> | void,
  ) => {
    const child = spawnUpscayl(args, logit);
    setChildProcesses(child);
    let failed = false;
    const onError = (error: unknown) => {
      if (failed || child.isCancelled()) return;
      failed = true;
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        String(error),
      );
      child.kill();
    };
    child.process.stderr.on("data", (data) => {
      if (failed || child.isCancelled()) return;
      const message = data.toString();
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.DOUBLE_UPSCAYL_PROGRESS,
        message,
      );
      if (message.includes("Error") || message.includes("failed"))
        onError(message);
      else if (message.includes("Resizing"))
        mainWindow.webContents.send(ELECTRON_COMMANDS.SCALING_AND_CONVERTING);
    });
    child.process.on("error", onError);
    child.process.on("close", async (code, signal) => {
      try {
        if (failed || child.isCancelled()) {
          cleanup();
          return;
        }
        if (
          code !== 0 ||
          signal ||
          !fs.existsSync(destination) ||
          !fs.statSync(destination).isFile() ||
          fs.statSync(destination).size === 0
        ) {
          onError(
            `Upscaling failed (exit ${code}, signal ${signal ?? "none"}) or produced no image.`,
          );
          cleanup();
          return;
        }
        await finished(child);
      } catch (error) {
        onError(error);
        cleanup();
      } finally {
        removeChildProcess(child);
      }
    });
  };
  runPass(
    getDoubleUpscaleArguments({
      inputDir: path.dirname(imagePath),
      fullfileName: path.basename(imagePath),
      outFile: intermediate,
      modelsPath: modelDirectory,
      model,
      scale,
      customWidth,
      gpuId,
      saveImageAs,
      tileSize,
    }),
    intermediate,
    () => {
      runPass(
        getDoubleUpscaleSecondPassArguments({
          inputFile: intermediate,
          outFile: result,
          modelsPath: modelDirectory,
          model,
          gpuId,
          saveImageAs,
          scale,
          customWidth,
          compression,
          tileSize,
          ttaMode,
        }),
        result,
        async (child) => {
          if (payload.copyMetadata) {
            try {
              await copyMetadata(imagePath, result);
            } catch (error) {
              mainWindow.webContents.send(
                ELECTRON_COMMANDS.METADATA_ERROR,
                String(error),
              );
            }
          }
          if (child.isCancelled()) {
            cleanup();
            return;
          }
          assertOutputAccess(outFile);
          fs.renameSync(result, outFile);
          cleanup();
          mainWindow.setProgressBar(-1);
          mainWindow.webContents.send(
            ELECTRON_COMMANDS.DOUBLE_UPSCAYL_DONE,
            outFile,
          );
          showNotification("Upscayled", "Image upscayled successfully!");
        },
      );
    },
  );
};

export default doubleUpscayl;
