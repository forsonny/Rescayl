import path from "path";

export default function decodePath(filePath: string): string {
  // Jobs receive filesystem paths, not URLs. Preserve literal percent escapes.
  return path.normalize(filePath);
}
