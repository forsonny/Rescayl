import { useAtom, useAtomValue } from "jotai";
import React, { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import { themeChange } from "theme-change";
import useLogger from "../../hooks/use-logger";
import {
  savedOutputPathAtom,
  progressAtom,
  rememberOutputFolderAtom,
  scaleAtom,
  customWidthAtom,
  useCustomWidthAtom,
} from "../../../atoms/user-settings-atom";
import { FEATURE_FLAGS } from "@common/feature-flags";
import { useToast } from "@/components/ui/use-toast";
import { translationAtom } from "@/atoms/translations-atom";
import { SelectImageScale } from "../settings-tab/select-image-scale";
import SelectModelDialog from "./select-model-dialog";
import { ImageFormat } from "@/lib/valid-formats";
import { fitsMosrPreview, MOSR_PREVIEW_MAX_EDGE, MOSR_PREVIEW_MAX_PIXELS } from "@common/mosr-preview";
import type { MosrGpu } from "@common/mosr-preview";

interface IProps {
  selectImageHandler: () => Promise<void>;
  selectFolderHandler: () => Promise<void>;
  upscaylHandler: (preview?: boolean) => Promise<void>;
  mosrGpu: string;
  setMosrGpu: React.Dispatch<React.SetStateAction<string>>;
  batchMode: boolean;
  setBatchMode: React.Dispatch<React.SetStateAction<boolean>>;
  imagePath: string;
  doubleUpscayl: boolean;
  setDoubleUpscayl: React.Dispatch<React.SetStateAction<boolean>>;
  dimensions: {
    width: number | null;
    height: number | null;
  };
  setSaveImageAs: React.Dispatch<React.SetStateAction<ImageFormat>>;
  setGpuId: React.Dispatch<React.SetStateAction<string>>;
}

function UpscaylSteps({
  selectImageHandler,
  selectFolderHandler,
  upscaylHandler,
  mosrGpu,
  setMosrGpu,
  batchMode,
  setBatchMode,
  imagePath,
  doubleUpscayl,
  setDoubleUpscayl,
  dimensions,
}: IProps) {
  const [scale, setScale] = useAtom(scaleAtom);
  const [outputPath, setOutputPath] = useAtom(savedOutputPathAtom);
  const [progress, setProgress] = useAtom(progressAtom);
  const rememberOutputFolder = useAtomValue(rememberOutputFolderAtom);
  const customWidth = useAtomValue(customWidthAtom);
  const useCustomWidth = useAtomValue(useCustomWidthAtom);
  const [mosrGpus, setMosrGpus] = useState<MosrGpu[]>([]);
  const [gpuLoading, setGpuLoading] = useState(true);
  const [gpuError, setGpuError] = useState("");

  useEffect(() => {
    if (window.electron.platform !== "win") return;
    let active = true;
    window.electron.getMosrGpus()
      .then(gpus => {
        if (!active) return;
        setMosrGpus(gpus);
        if (mosrGpu && !gpus.some(gpu => gpu.luid === mosrGpu)) {
          setMosrGpu("");
          setGpuError("Selected graphics processor unavailable. Using Default.");
        }
      })
      .catch(() => {
        if (!active) return;
        setMosrGpu("");
        setGpuError("Graphics processors couldn't be listed. You can still use Default.");
      })
      .finally(() => { if (active) setGpuLoading(false); });
    return () => { active = false; };
  }, []);

  const logit = useLogger();
  const { toast } = useToast();
  const t = useAtomValue(translationAtom);

  const outputHandler = async () => {
    const path = await window.electron.selectFolder();
    if (path !== null) {
      logit("🗂 Setting Output Path: ", path);
      setOutputPath(path);
    } else {
      setOutputPath(null);
    }
  };

  useEffect(() => {
    themeChange(false);
  }, []);

  const upscaylResolution = useMemo(() => {
    const newDimensions = {
      width: dimensions.width,
      height: dimensions.height,
    };

    let doubleScale = parseInt(scale) * parseInt(scale);
    let singleScale = parseInt(scale);

    if (doubleUpscayl) {
      if (useCustomWidth) {
        newDimensions.width = customWidth;
        newDimensions.height = Math.round(
          customWidth * (dimensions.height / dimensions.width),
        );
      } else {
        const newWidth = dimensions.width * doubleScale;
        const newHeight = dimensions.height * doubleScale;
        newDimensions.width = newWidth;
        newDimensions.height = newHeight;
      }
    } else {
      if (useCustomWidth) {
        newDimensions.width = customWidth;
        newDimensions.height = Math.round(
          customWidth * (dimensions.height / dimensions.width),
        );
      } else {
        newDimensions.width = dimensions.width * singleScale;
        newDimensions.height = dimensions.height * singleScale;
      }
    }

    return newDimensions;
  }, [dimensions.width, dimensions.height, doubleUpscayl, scale]);

  return (
    <div
      className={`animate-step-in animate flex h-screen flex-col gap-7 overflow-y-auto overflow-x-hidden p-5`}
    >
      {/* BATCH OPTION */}
      <div className="flex flex-row items-center gap-2">
        <input
          type="checkbox"
          className="toggle"
          defaultChecked={batchMode}
          onClick={() => {
            if (!rememberOutputFolder) {
              setOutputPath("");
            }
            setProgress("");
            setBatchMode((oldValue) => !oldValue);
          }}
        ></input>
        <p
          className="mr-1 inline-block cursor-help text-sm"
          data-tooltip-id="tooltip"
          data-tooltip-content={t("APP.BATCH_MODE.DESCRIPTION")}
        >
          {t("APP.BATCH_MODE.TITLE")}
        </p>
      </div>

      {/* STEP 1 */}
      <div className="animate-step-in">
        <p className="step-heading">{t("APP.FILE_SELECTION.TITLE")}</p>
        <button
          className="btn btn-primary"
          onClick={!batchMode ? selectImageHandler : selectFolderHandler}
          data-tooltip-id="tooltip"
          data-tooltip-content={imagePath}
        >
          {batchMode
            ? t("APP.FILE_SELECTION.BATCH_MODE_TYPE")
            : t("APP.FILE_SELECTION.SINGLE_MODE_TYPE")}
        </button>
      </div>

      {/* STEP 2 */}
      <div className="animate-step-in group flex flex-col gap-4">
        <div>
          <p className="step-heading">{t("APP.MODEL_SELECTION.TITLE")}</p>
          <p className="mb-2 text-sm">{t("APP.MODEL_SELECTION.DESCRIPTION")}</p>

          <SelectModelDialog />
        </div>

        {!batchMode && (
          <div className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox"
              checked={doubleUpscayl}
              onChange={(e) => {
                if (e.target.checked) {
                  setDoubleUpscayl(true);
                } else {
                  setDoubleUpscayl(false);
                }
              }}
            />
            <p
              className="cursor-pointer text-sm"
              onClick={(e) => {
                setDoubleUpscayl((prev) => !prev);
              }}
            >
              {t("APP.DOUBLE_UPSCAYL.TITLE")}
            </p>
            <button
              className="badge badge-neutral badge-sm cursor-help"
              data-tooltip-id="tooltip"
              data-tooltip-content={t("APP.DOUBLE_UPSCAYL.DESCRIPTION")}
            >
              ?
            </button>
          </div>
        )}

        <SelectImageScale scale={scale} setScale={setScale} hideInfo />
      </div>

      {/* STEP 3 */}
      <div className="animate-step-in">
        <div className="flex flex-col pb-2">
          <div className="step-heading flex items-center gap-2">
            <span className="leading-none">
              {t("APP.OUTPUT_PATH_SELECTION.TITLE")}
            </span>
            {FEATURE_FLAGS.APP_STORE_BUILD && (
              <button
                className="badge badge-outline badge-sm cursor-pointer"
                onClick={() =>
                  alert(t("APP.OUTPUT_PATH_SELECTION.MAC_APP_STORE_ALERT"))
                }
              >
                ?
              </button>
            )}
          </div>
          {!outputPath && FEATURE_FLAGS.APP_STORE_BUILD && (
            <div className="text-xs">
              <span className="rounded-btn bg-base-200 px-2 font-medium uppercase text-base-content/50">
                {t("APP.OUTPUT_PATH_SELECTION.NOT_SELECTED")}
              </span>
            </div>
          )}
        </div>
        {!batchMode && !FEATURE_FLAGS.APP_STORE_BUILD && (
          <p className="mb-2 text-sm">
            {!batchMode
              ? t("APP.OUTPUT_PATH_SELECTION.DEFAULT_IMG_PATH")
              : t("APP.OUTPUT_PATH_SELECTION.DEFAULT_FOLDER_PATH")}
          </p>
        )}
        <button
          className="btn btn-primary"
          data-tooltip-content={outputPath}
          data-tooltip-id="tooltip"
          onClick={outputHandler}
        >
          {t("APP.OUTPUT_PATH_SELECTION.BUTTON_TITLE")}
        </button>
      </div>

      {/* STEP 4 */}
      <div className="animate-step-in">
        <p className="step-heading">{t("APP.SCALE_SELECTION.TITLE")}</p>
        {dimensions.width && dimensions.height && (
          <p className="mb-2 text-sm">
            {t("APP.SCALE_SELECTION.FROM_TITLE")}
            <span className="font-bold">
              {dimensions.width}x{dimensions.height}
            </span>
            {t("APP.SCALE_SELECTION.TO_TITLE")}
            <span className="font-bold">
              {upscaylResolution.width}x{upscaylResolution.height}
            </span>
          </p>
        )}
        <button
          className="btn btn-secondary"
          onClick={
            progress.length > 0 || !outputPath
              ? () =>
                  toast({
                    description: t(
                      "APP.SCALE_SELECTION.NO_OUTPUT_FOLDER_ALERT",
                    ),
                  })
              : () => upscaylHandler()
          }
        >
          {progress.length > 0
            ? t("APP.SCALE_SELECTION.IN_PROGRESS_BUTTON_TITLE")
            : t("APP.SCALE_SELECTION.START_BUTTON_TITLE")}
        </button>
      </div>
      {window.electron.platform === "win" && !batchMode && (
        <div className="border-t border-base-content/20 pt-4">
          <p className="step-heading">Detail preview</p>
          <p className="mb-3 text-sm">
            Try a different enhancement for clear photos and artwork.
            Saves a separate 4× PNG.
          </p>
          <p className="mb-3 text-xs text-base-content/80">For small images. First use needs a one-time download.</p>
          <details className="mb-3">
            <summary className="cursor-pointer text-sm">Preview options</summary>
            <div className="mt-3 space-y-2">
          <label htmlFor="mosr-gpu" className="mb-1 block text-sm">Graphics processor</label>
          <select
            id="mosr-gpu"
            className="select select-bordered mb-2 w-full max-w-full"
            value={mosrGpu}
            disabled={gpuLoading || !!progress}
            onChange={event => setMosrGpu(event.target.value)}
          >
            <option value="">{mosrGpus.find(gpu => gpu.id === 0) ? `Default — ${mosrGpus.find(gpu => gpu.id === 0).name}` : "Default"}</option>
            {mosrGpus.map(gpu => <option key={gpu.luid} value={gpu.luid}>{gpu.name}</option>)}
          </select>
          <p className="mb-3 text-sm">
            {gpuLoading ? "Finding graphics processors…" : gpuError || "Used for previews until you close the app."}
          </p>
          <p className="text-xs text-base-content/80">
            Size limit: {MOSR_PREVIEW_MAX_PIXELS.toLocaleString()} pixels total,
            with neither side over {MOSR_PREVIEW_MAX_EDGE} pixels. Examples:
            512×512 or 1024×256.
          </p>
          <p className="text-xs text-base-content/80">Enhancement: MoSR. Initial download: 17 MB.</p>
            </div>
          </details>
          <button
            className="btn btn-primary"
            disabled={!!progress || !outputPath || !imagePath || !fitsMosrPreview(dimensions.width, dimensions.height)}
            onClick={() => upscaylHandler(true)}
          >
            Try detail preview
          </button>
          {imagePath && dimensions.width && dimensions.height && !fitsMosrPreview(dimensions.width, dimensions.height) && (
            <p className="mt-2 text-sm">This image is too large for the preview. Use the regular upscale button above, or choose a smaller image.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default UpscaylSteps;
