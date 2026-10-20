import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  ModelRequestBodyTooLargeError,
  ModelRequestImageError,
  prepareModelRequestImages,
} from "../src/model-gateway/image-input.js";

const bodyLimit = 128 * 1024 * 1024;

describe("prepareModelRequestImages", () => {
  it("leaves small images, remote URLs, file references, and text containing data URLs unchanged", async () => {
    const image = await pngImage(8);
    const untouched = [
      { type: "input_image", image_url: image, detail: "original" },
      { type: "input_image", image_url: "https://images.example.test/image.png" },
      { type: "input_image", file_id: "file-existing" },
      { type: "input_text", text: image },
    ];
    const large = { type: "input_image", image_url: await pngImage(128) };
    const body = { input: [{ role: "user", content: [...untouched, large] }] };
    const before = JSON.stringify(untouched);

    await prepareModelRequestImages(body, 8 * 1024);

    expect(JSON.stringify(body.input[0]?.content.slice(0, 4))).toBe(before);
    expect(large.image_url).toMatch(/^data:image\/webp;base64,/u);
  });

  it("preserves existing original-image requests below the preparation threshold", async () => {
    const image = await pngImage(768, 4);
    const part = { type: "input_image", image_url: image, detail: "original" };
    const body = { input: [{ role: "user", content: [part] }] };
    expect(image.length).toBeGreaterThan(1024 * 1024);

    await prepareModelRequestImages(body, bodyLimit);

    expect(part.image_url).toBe(image);
  });

  it("losslessly compresses original-size images while preserving dimensions, pixels, alpha, detail, and tool history", async () => {
    const image = await pngImage(768, 4);
    const part = { type: "input_image", image_url: image, detail: "original" };
    const body = { input: [{ type: "function_call_output", call_id: "view-image", output: [
      { type: "input_text", text: "original image" }, part,
    ] }] };

    await prepareModelRequestImages(body, 256 * 1024);

    expect(part.image_url).toMatch(/^data:image\/webp;base64,/u);
    expect(part.image_url.length).toBeLessThan(1024 * 1024);
    expect(part.detail).toBe("original");
    const original = await sharp(imageBytes(image)).raw().toBuffer({ resolveWithObject: true });
    const prepared = await sharp(imageBytes(part.image_url)).raw().toBuffer({ resolveWithObject: true });
    expect(prepared.info).toMatchObject({ width: 768, height: 768, channels: 4 });
    expect(prepared.data.equals(original.data)).toBe(true);
    expect(body.input[0]).toMatchObject({ call_id: "view-image", output: [{ text: "original image" }, { detail: "original" }] });
  });

  it("compresses each occurrence of repeated historical images without deleting duplicates", async () => {
    const image = await pngImage(128);
    const parts = Array.from({ length: 12 }, () => ({ type: "input_image", image_url: image }));
    const body = { input: [{ role: "user", content: parts }] };

    await prepareModelRequestImages(body, 16 * 1024);

    expect(parts).toHaveLength(12);
    expect(new Set(parts.map(part => part.image_url)).size).toBe(1);
    expect(parts.every(part => part.image_url !== image)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(16 * 1024);
  });

  it("uses bounded lossy encoding for dense images while retaining original dimensions", async () => {
    const pixels = Buffer.alloc(256 * 256 * 3);
    let seed = 17;
    for (let index = 0; index < pixels.length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    const png = await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
    const part = { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}`, detail: "original" };
    const body = { input: [{ role: "user", content: [part] }] };

    await prepareModelRequestImages(body, 100 * 1024);

    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(100 * 1024);
    expect(await sharp(imageBytes(part.image_url)).metadata()).toMatchObject({ width: 256, height: 256 });
    expect(part.detail).toBe("original");
  });

  it("applies EXIF orientation so displayed coordinates survive metadata removal", async () => {
    const png = await sharp({ create: { width: 512, height: 768, channels: 3, background: "#563398" } })
      .withMetadata({ orientation: 6 }).png({ compressionLevel: 0 }).toBuffer();
    const part = { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` };

    await prepareModelRequestImages({ input: [part] }, 128 * 1024);

    expect(await sharp(imageBytes(part.image_url)).metadata()).toMatchObject({ width: 768, height: 512 });
  });

  it("rejects excess non-image bytes instead of deleting messages or truncating text", async () => {
    const body = { input: [{ type: "input_text", text: "文".repeat(300) }] };
    const before = JSON.stringify(body);
    await expect(prepareModelRequestImages(body, 512)).rejects.toBeInstanceOf(ModelRequestBodyTooLargeError);
    expect(JSON.stringify(body)).toBe(before);
  });

  it("rejects a request that cannot fit after all bounded encoding attempts", async () => {
    const image = await pngImage(128);
    const part = { type: "input_image", image_url: image };
    await expect(prepareModelRequestImages({ input: [part] }, 96)).rejects.toBeInstanceOf(ModelRequestBodyTooLargeError);
  });

  it.each([
    "data:image/png;base64,%%%invalid%%%",
    `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64")}`,
    `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
    `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString("base64")}`,
  ])("redacts invalid or disguised image decoder errors", async (image) => {
    const body = { input: [{ type: "input_image", image_url: image }] };
    const limit = Buffer.byteLength(JSON.stringify(body)) - 1;
    await expect(prepareModelRequestImages(body, limit)).rejects.toEqual(new ModelRequestImageError());
  });

  it("stops preparing images when the client aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const body = { input: [{ type: "input_image", image_url: await pngImage(128) }] };
    await expect(prepareModelRequestImages(body, 16 * 1024, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

async function pngImage(size: number, channels: 3 | 4 = 3): Promise<string> {
  const png = await sharp({ create: { width: size, height: size, channels, background: { r: 120, g: 160, b: 200, alpha: 0.5 } } })
    .png({ compressionLevel: 0 }).toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function imageBytes(url: string): Buffer {
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}
