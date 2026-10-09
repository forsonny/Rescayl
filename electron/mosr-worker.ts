import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { fitsMosrPreview, MOSR_PREVIEW_MAX_EDGE, MOSR_PREVIEW_MAX_PIXELS } from "../common/mosr-preview";
import { getMosrGpus } from "./utils/get-mosr-gpus";

const MODEL_URL = "https://github.com/Phhofm/models/releases/download/4xNomos2_hq_mosr/4xNomos2_hq_mosr_fp32.onnx";
const MODEL_SHA256 = "f31fde6bd0e3475759aa5677d37b43b4e660d75e3629cd096bbc590feb746808";
const MODEL_BYTES = 17288863;

export async function getModel(cache: string): Promise<string> {
  const model = path.join(cache, `${MODEL_SHA256}.onnx`);
  const valid = (data: Buffer) => data.length === MODEL_BYTES && createHash("sha256").update(data).digest("hex") === MODEL_SHA256;
  if (fs.existsSync(model) && valid(await fs.promises.readFile(model))) return model;
  const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}). Try the preview again when online.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MODEL_BYTES) throw new Error("Model download has an unexpected size.");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (!valid(data)) throw new Error("Model download failed its integrity check. Try the preview again.");
  await fs.promises.mkdir(cache, { recursive: true });
  const temporary = `${model}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporary, data, { flag: "wx" });
    await fs.promises.rename(temporary, model);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  return model;
}

// Match the tested float32 clamp and ties-to-even RGB conversion.
export function quantize(value: number): number {
  const scaled = Math.fround(Math.max(0, Math.min(1, value)) * 255);
  const lower = Math.floor(scaled);
  return scaled - lower === 0.5 ? lower + (lower % 2) : Math.round(scaled);
}

// Keep the benchmark's Pillow bicubic alpha contract: pixel-center sampling,
// normalized edge weights, 22-bit coefficients and an 8-bit intermediate pass.
// Reference: https://github.com/python-pillow/Pillow/blob/12.3.0/src/libImaging/Resample.c
export function resizeAlpha4x(rgba: Buffer, width: number, height: number): Buffer {
  const precision = 2 ** 22;
  const coefficients = (size: number) => Array.from({ length: size * 4 }, (_, i) => {
    const center = (i + 0.5) / 4;
    const start = Math.max(0, Math.trunc(center - 1.5));
    const end = Math.min(size, Math.trunc(center + 2.5));
    const weights = Array.from({ length: end - start }, (_, j) => {
      const x = Math.abs(start + j + 0.5 - center);
      return x < 1 ? (1.5 * x - 2.5) * x * x + 1 : x < 2 ? ((-0.5 * x + 2.5) * x - 4) * x + 2 : 0;
    });
    const sum = weights.reduce((total, weight) => total + weight, 0);
    return { start, weights: weights.map(weight => {
      const scaled = weight / sum * precision;
      return Math.trunc(scaled + (scaled < 0 ? -0.5 : 0.5));
    }) };
  });
  const horizontal = coefficients(width);
  const vertical = coefficients(height);
  const wide = width * 4;
  const intermediate = Buffer.alloc(wide * height);
  const result = Buffer.alloc(wide * height * 4);
  const sample = (weights: number[], read: (j: number) => number) => {
    const total = weights.reduce((sum, weight, j) => sum + weight * read(j), precision / 2);
    return Math.max(0, Math.min(255, Math.floor(total / precision)));
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < wide; x++) {
    const { start, weights } = horizontal[x];
    intermediate[y * wide + x] = sample(weights, j => rgba[(y * width + start + j) * 4 + 3]);
  }
  for (let y = 0; y < height * 4; y++) for (let x = 0; x < wide; x++) {
    const { start, weights } = vertical[y];
    result[y * wide + x] = sample(weights, j => intermediate[(start + j) * wide + x]);
  }
  return result;
}

export async function upscale(input: string, output: string, cache: string, gpuLuid = "") {
  if (process.platform !== "win32") throw new Error("MoSR preview requires Windows with a DirectML GPU.");
  const source = sharp(input, { limitInputPixels: MOSR_PREVIEW_MAX_PIXELS });
  const metadata = await source.metadata();
  if (!fitsMosrPreview(metadata.width, metadata.height) || (metadata.pages ?? 1) > 1) {
    throw new Error(`MoSR preview accepts one still image with at most ${MOSR_PREVIEW_MAX_PIXELS.toLocaleString()} pixels and neither side over ${MOSR_PREVIEW_MAX_EDGE} pixels.`);
  }
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("MoSR preview accepts PNG, JPEG and WebP images.");
  let deviceId = 0;
  if (gpuLuid) {
    const gpu = (await getMosrGpus()).find(item => item.luid === gpuLuid.toLowerCase());
    if (!gpu) throw new Error("The selected MoSR GPU is no longer available. Choose another GPU or Default.");
    deviceId = gpu.id;
  }
  const { data, info } = await source.autoOrient().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const tensor = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) tensor[c * pixels + i] = data[i * 4 + c] / 255;
  }
  process.stderr.write("5.00%\n");
  const model = await getModel(cache);
  process.stderr.write("20.00%\n");
  const session = await ort.InferenceSession.create(model, {
    executionProviders: [{ name: "dml", deviceId }],
    enableMemPattern: false,
    executionMode: "sequential",
    graphOptimizationLevel: "all",
    logSeverityLevel: 4,
  });
  try {
    process.stderr.write("35.00%\n");
    const result = await session.run({ input: new ort.Tensor("float32", tensor, [1, 3, info.height, info.width]) });
    const width = info.width * 4;
    const height = info.height * 4;
    const count = width * height;
    const rgb = result.output.data as Float32Array;
    if (result.output.dims.join(",") !== [1, 3, height, width].join(",")) throw new Error("Unexpected MoSR output dimensions.");
    const channels = metadata.hasAlpha ? 4 : 3;
    const outputData = Buffer.alloc(count * channels);
    const alpha = metadata.hasAlpha ? resizeAlpha4x(data, info.width, info.height) : undefined;
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) outputData[i * channels + c] = quantize(rgb[c * count + i]);
      if (alpha) outputData[i * channels + 3] = alpha[i];
    }
    process.stderr.write("90.00%\n");
    await sharp(outputData, { raw: { width, height, channels } }).png().toFile(output);
  } finally {
    await session.release();
  }
}

if (require.main === module) {
  const [input, output, cache, gpuLuid] = process.argv.slice(2);
  upscale(input, output, cache, gpuLuid).catch((error) => {
    process.stderr.write(`0.00% Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
