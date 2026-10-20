import sharp from "sharp";
import { z } from "zod";

const MAX_IMAGE_URL_BYTES = 1024 * 1024;
const TOTAL_IMAGE_URL_BUDGET = 16 * 1024 * 1024;
const PREPARATION_THRESHOLD = 32 * 1024 * 1024;
const MAX_INPUT_PIXELS = 64 * 1024 * 1024;
const PREPARATION_TIMEOUT_MS = 30_000;
const IMAGE_URL_PREFIX = "data:image/webp;base64,";
const inputImage = z.object({
  type: z.literal("input_image"),
  image_url: z.string().startsWith("data:image/"),
});

export class ModelRequestBodyTooLargeError extends Error {
  constructor() {
    super("model request exceeds the size limit");
    this.name = "ModelRequestBodyTooLargeError";
  }
}

export class ModelRequestImageError extends Error {
  constructor() {
    super("model request image could not be prepared");
    this.name = "ModelRequestImageError";
  }
}

/** Only edits the transient wire request, never files or the Codex history. */
export async function prepareModelRequestImages(
  body: Record<string, unknown>,
  bodyLimit: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const originalSize = Buffer.byteLength(JSON.stringify(body));
  // Ordinary requests remain untouched. Prepare the full image history once
  // its wire size is significant, or when a smaller upstream budget requires it.
  if (originalSize <= Math.min(PREPARATION_THRESHOLD, bodyLimit)) return;
  const images: Array<{ part: Record<string, unknown>; url: string }> = [];
  const pending: unknown[] = [body.input];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const child of value) pending.push(child);
    } else if (isRecord(value)) {
      const parsed = inputImage.safeParse(value);
      if (parsed.success) {
        images.push({ part: value, url: parsed.data.image_url });
      } else {
        for (const child of Object.values(value)) pending.push(child);
      }
    }
  }

  if (images.length === 0) {
    if (originalSize > bodyLimit) throw new ModelRequestBodyTooLargeError();
    return;
  }
  const imageBytes = images.reduce((total, image) => total + Buffer.byteLength(image.url), 0);
  const availableBytes = Math.min(
    TOTAL_IMAGE_URL_BUDGET,
    bodyLimit - (originalSize - imageBytes),
  );
  if (availableBytes <= 0) throw new ModelRequestBodyTooLargeError();
  const imageBudget = Math.min(MAX_IMAGE_URL_BYTES, Math.floor(availableBytes / images.length));
  const prepared = new Map<string, string>();
  const deadline = performance.now() + PREPARATION_TIMEOUT_MS;
  for (const image of images) {
    signal?.throwIfAborted();
    if (image.url.length <= imageBudget) continue;
    let replacement = prepared.get(image.url);
    if (replacement === undefined) {
      replacement = await compressImage(image.url, imageBudget, deadline);
      prepared.set(image.url, replacement);
    }
    image.part.image_url = replacement;
  }
  signal?.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(body)) > bodyLimit) {
    throw new ModelRequestBodyTooLargeError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function compressImage(url: string, budget: number, deadline: number): Promise<string> {
  const matched = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(url);
  if (!matched?.[1] || !matched[2]) throw new ModelRequestImageError();
  const bytes = Buffer.from(matched[2], "base64");
  if (bytes.toString("base64") !== matched[2] || !hasRasterSignature(bytes, matched[1])) {
    throw new ModelRequestImageError();
  }

  let smallest = url;
  // Preserve pixels first. If needed, reduce encoding quality, never dimensions:
  // view_image and computer use may rely on original-image coordinates.
  for (const options of [
    { lossless: true, exact: true },
    { quality: 85, alphaQuality: 100 },
    { quality: 65, alphaQuality: 100 },
  ]) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) throw new ModelRequestImageError();
    let encoded: Buffer;
    try {
      encoded = await sharp(bytes, {
        animated: true,
        autoOrient: true,
        failOn: "warning",
        limitInputPixels: MAX_INPUT_PIXELS,
      }).webp({ ...options, effort: 0 })
        .timeout({ seconds: Math.min(5, Math.ceil(remainingMs / 1000)) })
        .toBuffer();
    } catch {
      // Decoder diagnostics can contain user-controlled metadata. Never expose them.
      throw new ModelRequestImageError();
    }
    const candidate = `${IMAGE_URL_PREFIX}${encoded.toString("base64")}`;
    if (candidate.length < smallest.length) smallest = candidate;
    if (smallest.length <= budget) break;
  }
  // The per-image budget is a target; the whole-request limit is enforced above.
  // An image that cannot reach the target must not invalidate an otherwise usable request.
  return smallest;
}

function hasRasterSignature(bytes: Buffer, format: string): boolean {
  // Prevent a declared raster MIME type from invoking a vector/document loader.
  if (format === "png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (format === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (format === "gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}
