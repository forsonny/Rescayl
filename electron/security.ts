import fs from "fs";
import path from "path";
import { MODELS } from "../common/models-list";
import { hasDirectoryAccess, hasImageAccess, hasModelAccess, isWithin } from "./path-access";
import { savedCustomModelsPath } from "./utils/config-variables";

export const rendererURL = (development: boolean) => development ? "http://localhost:8000" : "upscayl://app/index.html";

export const isTrustedRendererURL = (value: string, development: boolean) => {
  try {
    const url = new URL(value);
    return development
      ? url.origin === "http://localhost:8000" && (url.pathname === "/" || url.pathname === "/index.html")
      : url.protocol === "upscayl:" && url.hostname === "app" && url.pathname === "/index.html";
  } catch { return false; }
};

export const isSafeExternalURL = (value: string) => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};

export const canWriteClipboard = (
  contents: Electron.WebContents | null,
  trustedContents: Electron.WebContents | undefined,
  permission: string,
  details: { isMainFrame?: boolean; requestingUrl?: string },
  development: boolean,
) => permission === "clipboard-sanitized-write" && !!contents && contents === trustedContents && details.isMainFrame === true && !!details.requestingUrl && isTrustedRendererURL(details.requestingUrl, development) && isTrustedRendererURL(contents.getURL(), development);

export const resolveAssetPath = (root: string, pathname: string) => {
  const resolved = path.resolve(root, "." + decodeURIComponent(pathname));
  if (!isWithin(root, resolved)) throw new Error("Invalid asset path.");
  if (!isWithin(fs.realpathSync(root), fs.realpathSync(resolved))) throw new Error("Invalid asset target.");
  return resolved;
};

export const validateJobPayload = (payload: any, batch = false) => {
  if (!payload || typeof payload !== "object") throw new Error("Invalid upscale request.");
  const input = batch ? payload.batchFolderPath : payload.imagePath;
  if (!(batch ? hasDirectoryAccess(input) : hasImageAccess(input))) throw new Error("Select the input using the file or folder picker first.");
  if (!hasDirectoryAccess(payload.outputPath)) throw new Error("Select the output folder first.");
  if (typeof payload.model !== "string" || !payload.model || [".", ".."].includes(payload.model) || /[\\/\0:]/.test(payload.model)) throw new Error("Invalid model name.");
  if (!Object.prototype.hasOwnProperty.call(MODELS, payload.model)) {
    if (!savedCustomModelsPath || !hasModelAccess(savedCustomModelsPath)) throw new Error("Select a custom models folder first.");
    for (const extension of [".bin", ".param"]) {
      const file = path.join(savedCustomModelsPath, payload.model + extension);
      if (!fs.statSync(file).isFile() || !isWithin(fs.realpathSync(savedCustomModelsPath), fs.realpathSync(file))) throw new Error("The custom model must have a matching .bin and .param pair.");
    }
  }
  if (typeof payload.scale !== "string" || !/^(?:[1-9]|1[0-6])$/.test(payload.scale)) throw new Error("Invalid image scale.");
  if (!["png", "jpg", "jpeg", "webp"].includes(payload.saveImageAs)) throw new Error("Invalid image format.");
  if (payload.gpuId != null && (typeof payload.gpuId !== "string" || !/^\d+(,\d+)*$/.test(payload.gpuId))) throw new Error("Invalid GPU selection.");
  if (typeof payload.compression !== "string" || !/^\d{1,3}$/.test(payload.compression) || Number(payload.compression) > 100) throw new Error("Invalid compression.");
  if (payload.tileSize != null && payload.tileSize !== 0 && (!Number.isInteger(payload.tileSize) || payload.tileSize < 32)) throw new Error("Tile size must be at least 32.");
  for (const key of ["ttaMode", "copyMetadata", "noImageProcessing", "useCustomWidth"]) if (typeof payload[key] !== "boolean") throw new Error("Invalid upscale option: " + key);
  if (payload.overwrite !== undefined && typeof payload.overwrite !== "boolean") throw new Error("Invalid overwrite option.");
  if (payload.useCustomWidth && (typeof payload.customWidth !== "string" || !/^[1-9]\d{0,7}$/.test(payload.customWidth))) throw new Error("Invalid custom width.");
};

export const contentSecurityPolicy = (development: boolean) => [
  "default-src 'self'",
  `script-src 'self'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' upscayl: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://raw.githubusercontent.com https://us.i.posthog.com https://us-assets.i.posthog.com https://firestore.googleapis.com" + (development ? " ws://localhost:8000" : ""),
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
