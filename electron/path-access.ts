import fs from "fs";
import path from "path";
import settings from "electron-settings";

type Permissions = { files: string[]; directories: string[]; models: string[] };
let permissions: Permissions | undefined;

const canonical = (value: string) => {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new Error("Select a valid local file or folder first.");
  }
  const resolved = fs.realpathSync(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const getPermissions = () => {
  if (!permissions) {
    const saved = settings.getSync("revival-path-permissions") as Permissions | undefined;
    permissions = { files: saved?.files ?? [], directories: saved?.directories ?? [], models: saved?.models ?? [] };
  }
  return permissions;
};

export const isWithin = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
};

const grant = (kind: keyof Permissions, value: string) => {
  const resolved = canonical(value);
  const values = getPermissions()[kind];
  if (!values.includes(resolved)) {
    values.push(resolved);
    settings.setSync("revival-path-permissions", getPermissions());
  }
};

export const allowFile = (value: string) => {
  if (!fs.statSync(value).isFile()) throw new Error("Select an image file.");
  grant("files", value);
  grant("directories", path.dirname(value));
};

export const allowDirectory = (value: string) => {
  if (!fs.statSync(value).isDirectory()) throw new Error("Select a folder.");
  grant("directories", value);
};

export const allowModelDirectory = (value: string) => {
  if (!fs.statSync(value).isDirectory()) throw new Error("Select a models folder.");
  grant("models", value);
};

export const hasDirectoryAccess = (value: string) => {
  try {
    const resolved = canonical(value);
    return fs.statSync(value).isDirectory() && getPermissions().directories.some(root => isWithin(root, resolved));
  } catch { return false; }
};

export const hasModelAccess = (value: string) => {
  try { return getPermissions().models.includes(canonical(value)); }
  catch { return false; }
};

export const hasImageAccess = (value: string) => {
  try {
    if (!/\.(png|jpe?g|jfif|webp)$/i.test(value) || !fs.statSync(value).isFile()) return false;
    const resolved = canonical(value);
    return getPermissions().files.includes(resolved) || getPermissions().directories.some(root => isWithin(root, resolved));
  } catch { return false; }
};

export const assertOutputAccess = (value: string) => {
  if (!hasDirectoryAccess(path.dirname(value))) throw new Error("Output is outside the selected folder.");
  if (fs.existsSync(value) && !isWithin(fs.realpathSync(path.dirname(value)), fs.realpathSync(value))) throw new Error("Output resolves outside the selected folder.");
};
