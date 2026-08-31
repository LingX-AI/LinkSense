import sharp from "sharp"

const MAX_INPUT_PIXELS = 8_294_400
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024
const ALPHA_NOISE_FLOOR = 8
const KEY_DOMINANCE_THRESHOLD = 16
const MIN_TRANSPARENT_RATIO = 0.01
const MIN_VISIBLE_RATIO = 0.0025
const MIN_TRANSPARENT_CORNER_RATIO = 0.75

type Color = readonly [number, number, number]

const CHROMA_KEY_COLORS = {
  green: [0, 255, 0],
  magenta: [255, 0, 255],
} as const satisfies Record<string, Color>

export type ImageTransparencyStrategy =
  | { kind: "none" }
  | { kind: "native" }
  | { kind: "chroma_key"; chromaKey: keyof typeof CHROMA_KEY_COLORS }

export type PreparedImage = {
  bytes: Buffer
  mimeType: "image/png" | "image/jpeg" | "image/webp"
  hasTransparency: boolean
}

export class ImageTransparencyValidationError extends Error {
  constructor() {
    super("transparent image validation failed")
    this.name = "ImageTransparencyValidationError"
  }
}

export async function prepareGeneratedImage(
  image: {
    bytes: Buffer
    mimeType: "image/png" | "image/jpeg" | "image/webp"
  },
  strategy: ImageTransparencyStrategy,
): Promise<PreparedImage> {
  try {
    return await prepareGeneratedImageUnchecked(image, strategy)
  } catch (error) {
    if (error instanceof ImageTransparencyValidationError) throw error
    throw new ImageTransparencyValidationError()
  }
}

async function prepareGeneratedImageUnchecked(
  image: {
    bytes: Buffer
    mimeType: "image/png" | "image/jpeg" | "image/webp"
  },
  strategy: ImageTransparencyStrategy,
): Promise<PreparedImage> {
  if (strategy.kind === "none") {
    return { ...image, hasTransparency: false }
  }

  const decoded = await decodeRgba(image.bytes)
  if (strategy.kind === "chroma_key") {
    applyChromaKey(decoded, CHROMA_KEY_COLORS[strategy.chromaKey])
  }
  validateAlpha(decoded)

  const bytes = await sharp(decoded.pixels, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw new ImageTransparencyValidationError()
  }
  return {
    bytes,
    mimeType: "image/png",
    hasTransparency: true,
  }
}

type RgbaImage = {
  pixels: Buffer
  width: number
  height: number
}

async function decodeRgba(bytes: Buffer): Promise<RgbaImage> {
  try {
    const { data, info } = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 4 || info.width < 1 || info.height < 1) {
      throw new ImageTransparencyValidationError()
    }
    return { pixels: data, width: info.width, height: info.height }
  } catch (error) {
    if (error instanceof ImageTransparencyValidationError) throw error
    throw new ImageTransparencyValidationError()
  }
}

function applyChromaKey(image: RgbaImage, expectedKey: Color): void {
  const sampledKey = sampleBorderKey(image)
  if (!isCompatibleKey(sampledKey, expectedKey)) {
    throw new ImageTransparencyValidationError()
  }

  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const rgb = colorAt(image.pixels, offset)
    const inputAlpha = image.pixels[offset + 3] ?? 255
    const distance = channelDistance(rgb, sampledKey)
    const keyLike = looksKeyColored(rgb, sampledKey, distance)
    let outputAlpha = 255
    if (keyLike) {
      outputAlpha = Math.min(
        softAlpha(distance, 12, 220),
        dominanceAlpha(rgb, sampledKey),
      )
    }
    outputAlpha = Math.round(outputAlpha * (inputAlpha / 255))
    if (outputAlpha <= ALPHA_NOISE_FLOOR) outputAlpha = 0

    if (outputAlpha === 0) {
      image.pixels[offset] = 0
      image.pixels[offset + 1] = 0
      image.pixels[offset + 2] = 0
      image.pixels[offset + 3] = 0
      continue
    }

    const cleaned = keyLike
      ? cleanupSpill(rgb, sampledKey, outputAlpha)
      : rgb
    image.pixels[offset] = cleaned[0]
    image.pixels[offset + 1] = cleaned[1]
    image.pixels[offset + 2] = cleaned[2]
    image.pixels[offset + 3] = outputAlpha
  }
}

function validateAlpha(image: RgbaImage): void {
  const total = image.width * image.height
  let transparent = 0
  let visible = 0
  for (let offset = 3; offset < image.pixels.length; offset += 4) {
    const alpha = image.pixels[offset] ?? 255
    if (alpha <= ALPHA_NOISE_FLOOR) transparent += 1
    else visible += 1
  }
  if (
    transparent / total < MIN_TRANSPARENT_RATIO ||
    visible / total < MIN_VISIBLE_RATIO ||
    transparentCornerRatio(image) < MIN_TRANSPARENT_CORNER_RATIO
  ) {
    throw new ImageTransparencyValidationError()
  }
}

function transparentCornerRatio(image: RgbaImage): number {
  const patch = Math.max(1, Math.min(image.width, image.height, 12))
  const origins = [
    [0, 0],
    [image.width - patch, 0],
    [0, image.height - patch],
    [image.width - patch, image.height - patch],
  ] as const
  let transparent = 0
  let total = 0
  for (const [left, top] of origins) {
    for (let y = top; y < top + patch; y += 1) {
      for (let x = left; x < left + patch; x += 1) {
        const alpha = image.pixels[(y * image.width + x) * 4 + 3] ?? 255
        if (alpha <= ALPHA_NOISE_FLOOR) transparent += 1
        total += 1
      }
    }
  }
  return total === 0 ? 0 : transparent / total
}

function sampleBorderKey(image: RgbaImage): Color {
  const samples: Array<[number, number, number]> = []
  const band = Math.max(1, Math.min(image.width, image.height, 6))
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 256))
  for (let x = 0; x < image.width; x += step) {
    for (let y = 0; y < band; y += 1) {
      samples.push(pixelAt(image, x, y))
      samples.push(pixelAt(image, x, image.height - 1 - y))
    }
  }
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < band; x += 1) {
      samples.push(pixelAt(image, x, y))
      samples.push(pixelAt(image, image.width - 1 - x, y))
    }
  }
  if (samples.length === 0) throw new ImageTransparencyValidationError()
  return [
    median(samples.map((sample) => sample[0])),
    median(samples.map((sample) => sample[1])),
    median(samples.map((sample) => sample[2])),
  ]
}

function median(values: number[]): number {
  values.sort((left, right) => left - right)
  const middle = Math.floor(values.length / 2)
  if (values.length % 2 === 1) return values[middle] ?? 0
  return Math.round(((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2)
}

function isCompatibleKey(sampled: Color, expected: Color): boolean {
  return (
    channelDistance(sampled, expected) <= 128 &&
    keyChannelDominance(sampled, expected) >= 64
  )
}

function pixelAt(image: RgbaImage, x: number, y: number): [number, number, number] {
  return colorAt(image.pixels, (y * image.width + x) * 4)
}

function colorAt(bytes: Buffer, offset: number): [number, number, number] {
  return [bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0]
}

function channelDistance(left: Color, right: Color): number {
  return Math.max(
    Math.abs(left[0] - right[0]),
    Math.abs(left[1] - right[1]),
    Math.abs(left[2] - right[2]),
  )
}

function softAlpha(
  distance: number,
  transparentThreshold: number,
  opaqueThreshold: number,
): number {
  if (distance <= transparentThreshold) return 0
  if (distance >= opaqueThreshold) return 255
  const ratio =
    (distance - transparentThreshold) /
    (opaqueThreshold - transparentThreshold)
  const smooth = ratio * ratio * (3 - 2 * ratio)
  return clampChannel(255 * smooth)
}

function dominanceAlpha(rgb: Color, key: Color): number {
  const dominance = keyChannelDominance(rgb, key)
  if (dominance <= 0) return 255
  const spillChannels = keySpillChannels(key)
  const nonSpill = [0, 1, 2].filter((channel) => !spillChannels.includes(channel))
  const nonKeyStrength = Math.max(...nonSpill.map((channel) => rgb[channel] ?? 0), 0)
  const denominator = Math.max(1, Math.max(...key) - nonKeyStrength)
  return clampChannel((1 - Math.min(1, dominance / denominator)) * 255)
}

function looksKeyColored(rgb: Color, key: Color, distance: number): boolean {
  return (
    distance <= 32 ||
    keySpillChannels(key).length === 0 ||
    keyChannelDominance(rgb, key) >= KEY_DOMINANCE_THRESHOLD
  )
}

function keyChannelDominance(rgb: Color, key: Color): number {
  const spillChannels = keySpillChannels(key)
  if (spillChannels.length === 0) return 0
  const nonSpill = [0, 1, 2].filter((channel) => !spillChannels.includes(channel))
  const keyStrength = Math.min(
    ...spillChannels.map((channel) => rgb[channel] ?? 0),
  )
  const nonKeyStrength = Math.max(...nonSpill.map((channel) => rgb[channel] ?? 0), 0)
  return keyStrength - nonKeyStrength
}

function keySpillChannels(key: Color): number[] {
  const maximum = Math.max(...key)
  if (maximum < 128) return []
  return [0, 1, 2].filter(
    (channel) => (key[channel] ?? 0) >= maximum - 16 && (key[channel] ?? 0) >= 128,
  )
}

function cleanupSpill(rgb: Color, key: Color, alpha: number): Color {
  if (alpha >= 252) return rgb
  const channels = [...rgb]
  const spillChannels = keySpillChannels(key)
  const nonSpill = [0, 1, 2].filter((channel) => !spillChannels.includes(channel))
  const anchor = Math.max(...nonSpill.map((channel) => channels[channel] ?? 0), 0)
  const cap = Math.max(0, anchor - 1)
  for (const channel of spillChannels) {
    if ((channels[channel] ?? 0) > cap) channels[channel] = cap
  }
  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0]
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
