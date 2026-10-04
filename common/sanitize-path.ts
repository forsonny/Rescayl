export function sanitizePath(filePath: string) {
  return filePath ? "upscayl://image/" + encodeURIComponent(filePath) : "";
}
