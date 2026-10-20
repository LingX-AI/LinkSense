import {
  imageEditingLimits,
  type ImageGenerationProvider,
  type ImageGenerationRequest,
} from "@linksense/shared"
import sharp, { type Metadata } from "sharp"

import { AppError } from "../../lib/errors.js"
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js"

type InputImage = NonNullable<ImageGenerationRequest["input_images"]>[number]

/** Only route model contracts whose image fields have been verified. */
function editingProfile(provider: ImageGenerationProvider, model: string): { maxImages: number; mask: boolean } {
  switch (provider) {
    case "openai_compatible":
      if (/^(?:gpt-image-|chatgpt-image-)/u.test(model)) return { maxImages: imageEditingLimits.maxImages, mask: true }
      if (/^qwen-image-(?:edit|[2-9]\.)/iu.test(model)) return { maxImages: 3, mask: false }
      // An OpenAI-compatible address alone does not establish multi-image or mask support.
      return { maxImages: 1, mask: false }
    case "openai":
      if (/^(?:gpt-image-|chatgpt-image-)/u.test(model)) return { maxImages: imageEditingLimits.maxImages, mask: true }
      break
    case "google_gemini":
      if (/^gemini-.*image/u.test(model)) return { maxImages: imageEditingLimits.maxImages, mask: false }
      break
    case "alibaba_bailian":
      if (/^qwen-image-(?:edit|[2-9]\.)/u.test(model)) return { maxImages: 3, mask: false }
      break
    case "fal":
      if (/^fal-ai\/flux-2(?:\/[^/]+)*\/edit$/u.test(model) || model === "fal-ai/flux-pro/kontext/multi") {
        return { maxImages: imageEditingLimits.maxImages, mask: false }
      }
      if (["fal-ai/flux-pro/kontext", "fal-ai/flux-kontext/dev"].includes(model)) return { maxImages: 1, mask: false }
      break
    case "replicate":
      if (/^black-forest-labs\/flux-kontext-(?:pro|max|dev)$/u.test(model)) return { maxImages: 1, mask: false }
      break
    case "together":
      if (/^black-forest-labs\/FLUX\.2-(?:pro|dev|flex)$/u.test(model)) return { maxImages: imageEditingLimits.maxImages, mask: false }
      if (/^black-forest-labs\/FLUX\.1-kontext-(?:pro|max)$/u.test(model)) return { maxImages: 1, mask: false }
      break
    case "stability":
      break
  }
  throw new AppError("IMAGE_GENERATION_EDIT_UNSUPPORTED")
}

export async function validateImageEditingRequest(
  provider: ImageGenerationProvider,
  model: string,
  request: ImageGenerationRequest,
): Promise<void> {
  if (!request.input_images?.length) return
  const profile = editingProfile(provider, model)
  if (request.input_images.length > profile.maxImages || (request.mask && !profile.mask)) {
    throw new AppError("IMAGE_GENERATION_EDIT_UNSUPPORTED")
  }
  try {
    let totalBytes = 0
    const inspect = async (image: InputImage, requireTransparency = false): Promise<Metadata> => {
      const bytes = Buffer.from(image.data_base64, "base64")
      totalBytes += bytes.length
      if (bytes.length > imageEditingLimits.maxImageBytes || totalBytes > imageEditingLimits.maxTotalBytes ||
        bytes.toString("base64") !== image.data_base64 || detectSafeRasterImage(bytes) !== image.mime_type) {
        throw new Error("invalid image bytes")
      }
      const imageReader = sharp(bytes, { limitInputPixels: imageEditingLimits.maxPixels })
      const metadata = await imageReader.metadata()
      if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error("invalid image dimensions")
      // Decode before forwarding: a valid header alone does not establish a usable image.
      const stats = await imageReader.stats()
      if (requireTransparency && stats.isOpaque) throw new Error("mask_has_no_editable_region")
      return metadata
    }
    const originals: Metadata[] = []
    for (const image of request.input_images) originals.push(await inspect(image))
    if (request.mask) {
      const mask = await inspect(request.mask, true)
      if (request.mask.mime_type !== "image/png" || !mask.hasAlpha ||
        mask.width !== originals[0]?.width || mask.height !== originals[0]?.height) {
        throw new Error("invalid edit mask")
      }
    }
  } catch {
    throw new AppError("IMAGE_GENERATION_INPUT_INVALID")
  }
}

export function inputImageDataUrl(image: InputImage): string {
  return `data:${image.mime_type};base64,${image.data_base64}`
}
