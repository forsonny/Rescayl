import fs from "fs";
import path from "path";
import { getMainWindow } from "../main-window";
import {
  setChildProcesses,
  removeChildProcess,
  savedCustomModelsPath,
} from "../utils/config-variables";
import logit from "../utils/logit";
import { spawnUpscayl } from "../utils/spawn-upscayl";
import { getBatchArguments } from "../utils/get-arguments";
import slash from "../utils/slash";
import { modelsPath } from "../utils/get-resource-paths";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import { BatchUpscaylPayload } from "../../common/types/types";
import showNotification from "../utils/show-notification";
import { MODELS } from "../../common/models-list";
import { copyMetadata } from "../utils/copy-metadata";
import { assertOutputAccess } from "../path-access";

const batchUpscayl = async (event, payload: BatchUpscaylPayload) => {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;

  const tileSize = payload.tileSize;
  const compression = payload.compression;
  const ttaMode = payload.ttaMode;
  const scale = payload.scale;
  const useCustomWidth = payload.useCustomWidth;
  const customWidth = useCustomWidth ? payload.customWidth : "";
  const model = payload.model;
  const gpuId = payload.gpuId;
  const saveImageAs = payload.saveImageAs;
  // GET THE IMAGE DIRECTORY
  let inputDir = payload.batchFolderPath;
  // GET THE OUTPUT DIRECTORY
  let outputFolderPath = payload.outputPath;
  const outputFolderName = `rescayl_${saveImageAs}_${model}_${
    useCustomWidth ? `${customWidth}px` : `${scale}x`
  }`;
  outputFolderPath += slash + outputFolderName;
  assertOutputAccess(outputFolderPath);
  // CREATE THE OUTPUT DIRECTORY
  if (!fs.existsSync(outputFolderPath)) {
    fs.mkdirSync(outputFolderPath, { recursive: true });
  }

  const isDefaultModel = model in MODELS;

  // UPSCALE
  const upscayl = spawnUpscayl(
    getBatchArguments({
      inputDir,
      outputDir: outputFolderPath,
      modelsPath: isDefaultModel
        ? modelsPath
        : (savedCustomModelsPath ?? modelsPath),
      model,
      gpuId,
      saveImageAs,
      scale,
      customWidth,
      compression,
      tileSize,
      ttaMode,
    }),
    logit,
  );

  setChildProcesses(upscayl);
  let failed = false;
  let encounteredError = false;

  const onData = (data: any) => {
    if (failed || upscayl.isCancelled()) return;
    data = data.toString();
    mainWindow.webContents.send(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_PROGRESS,
      data.toString(),
    );
    if (
      (data as string).includes("Error") ||
      (data as string).includes("failed")
    ) {
      logit("❌ ", data);
      encounteredError = true;
      onError(data);
    } else if (data.includes("Resizing")) {
      mainWindow.webContents.send(ELECTRON_COMMANDS.SCALING_AND_CONVERTING);
    }
  };
  const onError = (data: any) => {
    if (failed || upscayl.isCancelled()) return;
    mainWindow.setProgressBar(-1);
    mainWindow.webContents.send(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_PROGRESS,
      data.toString(),
    );
    failed = true;
    upscayl.kill();
    mainWindow &&
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        `Error upscaling images! ${data}`,
      );
    return;
  };
  const onClose = async (code: number | null, signal: string | null) => {
    try {
      if (!failed && !upscayl.isCancelled()) {
        const sources = fs
          .readdirSync(inputDir)
          .filter(
            (file) =>
              /\.(png|jpg|jpeg|jfif|webp)$/i.test(file) &&
              fs.statSync(path.join(inputDir, file)).isFile(),
          );
        const outputs = sources.map((file) =>
          path.join(
            outputFolderPath,
            path.parse(file).name + "." + saveImageAs,
          ),
        );
        if (
          code !== 0 ||
          signal ||
          outputs.length === 0 ||
          outputs.some(
            (file) =>
              !fs.existsSync(file) ||
              !fs.statSync(file).isFile() ||
              fs.statSync(file).size === 0,
          )
        ) {
          onError(
            `Upscaling failed (exit ${code}, signal ${signal ?? "none"}) or did not produce all images.`,
          );
          return;
        }
        logit("💯 Done upscaling");
        upscayl.kill();
        if (payload.copyMetadata) {
          logit("🏷️ Copying metadata...");
          try {
            for (const file of sources) {
              if (upscayl.isCancelled()) return;
              const outFile = path.join(
                outputFolderPath,
                path.parse(file).name + "." + saveImageAs,
              );
              const originalFile = path.join(inputDir, file);
              if (fs.existsSync(outFile) && fs.existsSync(originalFile)) {
                try {
                  await copyMetadata(originalFile, outFile);
                  logit("✅ Metadata copied to: ", outFile);
                } catch (error) {
                  logit("❌ Error copying metadata: ", error);
                  mainWindow.webContents.send(
                    ELECTRON_COMMANDS.METADATA_ERROR,
                    String(error),
                  );
                }
              }
            }
          } catch (err) {
            logit("❌ Error in batch metadata copy: ", err);
          }
        }
        if (upscayl.isCancelled()) return;
        mainWindow.setProgressBar(-1);
        mainWindow.webContents.send(
          ELECTRON_COMMANDS.FOLDER_UPSCAYL_DONE,
          outputFolderPath,
        );
        if (!encounteredError) {
          showNotification("Rescayl", "Images upscaled successfully!");
        } else {
          showNotification(
            "Rescayl",
            "Images were upscaled but encountered some errors!",
          );
        }
      } else {
        upscayl.kill();
      }
    } catch (error) {
      onError(error);
    } finally {
      removeChildProcess(upscayl);
    }
  };
  upscayl.process.stderr.on("data", onData);
  upscayl.process.on("error", onError);
  upscayl.process.on("close", onClose);
};

export default batchUpscayl;
