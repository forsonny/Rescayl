import type { BatchUpscaylPayload, DoubleUpscaylPayload, ImageUpscaylPayload } from "./types/types";
import type { MosrGpu } from "./mosr-preview";

type Subscription<T> = (listener: (data: T) => void) => () => void;

export interface DesktopAPI {
  platform: "mac" | "win" | "linux";
  selectImage(): Promise<string | null>;
  selectFolder(): Promise<string | null>;
  selectCustomModels(): Promise<string | null>;
  loadDroppedFile(file: File): Promise<string>;
  upscale(payload: ImageUpscaylPayload): void;
  upscaleBatch(payload: BatchUpscaylPayload): void;
  upscaleDouble(payload: DoubleUpscaylPayload): void;
  stop(): void;
  openFolder(path: string): void;
  loadModels(path: string): void;
  pasteImage(encodedBuffer: string): void;
  writeLog(message: string): void;
  getSystemInfo(): Promise<{ platform: string; release: string; arch: string; model: string; cpuCount: number; gpu?: Record<string, any> }>;
  getAppVersion(): Promise<string>;
  getMosrGpus(): Promise<MosrGpu[]>;
  onLog: Subscription<string>;
  onFinishing: Subscription<string>;
  onWarning: Subscription<string>;
  onError: Subscription<string>;
  onMetadataError: Subscription<string>;
  onProgress: Subscription<string>;
  onBatchProgress: Subscription<string>;
  onDoubleProgress: Subscription<string>;
  onDone: Subscription<string>;
  onBatchDone: Subscription<string>;
  onDoubleDone: Subscription<string>;
  onModels: Subscription<string[]>;
  onPasteSuccess: Subscription<string>;
  onPasteError: Subscription<string>;
  onCancelled: Subscription<void>;
}
