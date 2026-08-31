import sharp from "sharp"
import { describe, expect, it } from "vitest"

import {
  ImageTransparencyValidationError,
  prepareGeneratedImage,
} from "../src/modules/system/image-transparency.js"

describe("prepareGeneratedImage", () => {
  it("preserves opaque image bytes when transparency is not requested", async () => {
    const bytes = await solidPng([12, 34, 56, 255])

    await expect(
      prepareGeneratedImage(
        { bytes, mimeType: "image/png" },
        { kind: "none" },
      ),
    ).resolves.toEqual({
      bytes,
      mimeType: "image/png",
      hasTransparency: false,
    })
  })

  it("removes a green chroma background and preserves the foreground", async () => {
    const bytes = await keyedSubjectPng(
      [0, 255, 0, 255],
      [230, 40, 30, 255],
    )

    const result = await prepareGeneratedImage(
      { bytes, mimeType: "image/png" },
      { kind: "chroma_key", chromaKey: "green" },
    )
    const image = await decode(result.bytes)

    expect(result.mimeType).toBe("image/png")
    expect(result.hasTransparency).toBe(true)
    expect(alphaAt(image, 0, 0)).toBe(0)
    expect(alphaAt(image, 16, 16)).toBe(255)
    expect(colorAt(image, 16, 16)).toEqual([230, 40, 30])
  })

  it("supports a magenta key for predominantly green foreground subjects", async () => {
    const bytes = await keyedSubjectPng(
      [255, 0, 255, 255],
      [30, 210, 60, 255],
    )

    const result = await prepareGeneratedImage(
      { bytes, mimeType: "image/png" },
      { kind: "chroma_key", chromaKey: "magenta" },
    )
    const image = await decode(result.bytes)

    expect(alphaAt(image, 0, 0)).toBe(0)
    expect(alphaAt(image, 16, 16)).toBe(255)
    expect(colorAt(image, 16, 16)).toEqual([30, 210, 60])
  })

  it("rejects chroma output whose border does not match the requested key", async () => {
    const bytes = await keyedSubjectPng(
      [40, 80, 180, 255],
      [230, 40, 30, 255],
    )

    await expect(
      prepareGeneratedImage(
        { bytes, mimeType: "image/png" },
        { kind: "chroma_key", chromaKey: "green" },
      ),
    ).rejects.toBeInstanceOf(ImageTransparencyValidationError)
  })

  it("accepts native alpha output and rejects an opaque native result", async () => {
    const transparent = await keyedSubjectPng(
      [0, 0, 0, 0],
      [80, 120, 220, 255],
    )
    const opaque = await solidPng([80, 120, 220, 255])

    await expect(
      prepareGeneratedImage(
        { bytes: transparent, mimeType: "image/png" },
        { kind: "native" },
      ),
    ).resolves.toMatchObject({
      mimeType: "image/png",
      hasTransparency: true,
    })
    await expect(
      prepareGeneratedImage(
        { bytes: opaque, mimeType: "image/png" },
        { kind: "native" },
      ),
    ).rejects.toBeInstanceOf(ImageTransparencyValidationError)
  })
})

async function solidPng(
  color: readonly [number, number, number, number],
): Promise<Buffer> {
  return rawPng(32, 32, () => color)
}

async function keyedSubjectPng(
  background: readonly [number, number, number, number],
  foreground: readonly [number, number, number, number],
): Promise<Buffer> {
  return rawPng(32, 32, (x, y) =>
    x >= 8 && x < 24 && y >= 8 && y < 24 ? foreground : background,
  )
}

async function rawPng(
  width: number,
  height: number,
  pixel: (
    x: number,
    y: number,
  ) => readonly [number, number, number, number],
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const color = pixel(x, y)
      data[offset] = color[0]
      data[offset + 1] = color[1]
      data[offset + 2] = color[2]
      data[offset + 3] = color[3]
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function decode(bytes: Buffer): Promise<{
  data: Buffer
  width: number
}> {
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  return { data: decoded.data, width: decoded.info.width }
}

function alphaAt(
  image: { data: Buffer; width: number },
  x: number,
  y: number,
): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? -1
}

function colorAt(
  image: { data: Buffer; width: number },
  x: number,
  y: number,
): [number, number, number] {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] ?? -1,
    image.data[offset + 1] ?? -1,
    image.data[offset + 2] ?? -1,
  ]
}
