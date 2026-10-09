export const MOSR_PREVIEW_MODEL = "mosr-clean-preview-4x";
export const MOSR_PREVIEW_MAX_EDGE = 1024;
export const MOSR_PREVIEW_MAX_PIXELS = 262_144;

export type MosrGpu = { id: number; name: string; luid: string };

export const fitsMosrPreview = (
  width: number | null | undefined,
  height: number | null | undefined,
) => width != null && height != null && width > 0 && height > 0 &&
  width <= MOSR_PREVIEW_MAX_EDGE && height <= MOSR_PREVIEW_MAX_EDGE &&
  width * height <= MOSR_PREVIEW_MAX_PIXELS;
