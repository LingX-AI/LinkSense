import { describe, expect, it } from "vitest";

import {
  detectSafeRasterImage,
  detectSafeSiteIcon,
} from "../src/lib/safe-raster-image.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function iconWithPayload(payload: Buffer): Buffer {
  const value = Buffer.alloc(22 + payload.byteLength);
  value.writeUInt16LE(0, 0);
  value.writeUInt16LE(1, 2);
  value.writeUInt16LE(1, 4);
  value[6] = 1;
  value[7] = 1;
  value.writeUInt16LE(1, 10);
  value.writeUInt16LE(32, 12);
  value.writeUInt32LE(payload.byteLength, 14);
  value.writeUInt32LE(22, 18);
  payload.copy(value, 22);
  return value;
}

function onePixelIcon(): Buffer {
  return iconWithPayload(ONE_PIXEL_PNG);
}

function onePixelDibIcon(): Buffer {
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(1, 4);
  dib.writeInt32LE(2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  return iconWithPayload(dib);
}

function webpWithVariant(variant: "VP8 " | "VP8L" | "VP8X"): Buffer {
  const value = Buffer.alloc(variant === "VP8L" ? 25 : 30);
  value.write("RIFF", 0, "ascii");
  value.writeUInt32LE(value.byteLength - 8, 4);
  value.write("WEBP", 8, "ascii");
  value.write(variant, 12, "ascii");
  value.writeUInt32LE(value.byteLength - 20, 16);
  if (variant === "VP8X") {
    value[24] = 0;
    value[27] = 0;
  }
  if (variant === "VP8 ") {
    value[23] = 0x9d;
    value[24] = 0x01;
    value[25] = 0x2a;
    value.writeUInt16LE(1, 26);
    value.writeUInt16LE(1, 28);
  }
  if (variant === "VP8L") value[20] = 0x2f;
  return value;
}

describe("detectSafeRasterImage", () => {
  it("supports a caller-defined maximum image dimension", () => {
    const oversized = Buffer.from(ONE_PIXEL_PNG);
    oversized.writeUInt32BE(1_025, 16);

    expect(detectSafeRasterImage(oversized)).toBe("image/png");
    expect(detectSafeRasterImage(oversized, 1_024)).toBeNull();
  });

  it("keeps ICO files out of the capability-logo image type", () => {
    expect(detectSafeRasterImage(onePixelIcon())).toBeNull();
  });

  it("accepts a structurally valid ICO favicon only for site icons", () => {
    expect(detectSafeSiteIcon(onePixelIcon())).toBe("image/x-icon");
  });

  it("accepts a plausible DIB payload inside an ICO favicon", () => {
    expect(detectSafeSiteIcon(onePixelDibIcon())).toBe("image/x-icon");
  });

  it("rejects an ICO with an arbitrary image payload", () => {
    expect(detectSafeSiteIcon(iconWithPayload(Buffer.alloc(4)))).toBeNull();
  });

  it("rejects an ICO whose directory points outside the file", () => {
    const value = onePixelIcon();
    value.writeUInt32LE(27, 18);

    expect(detectSafeSiteIcon(value)).toBeNull();
  });

  it.each(["VP8 ", "VP8L", "VP8X"] as const)(
    "accepts a valid %s WebP image",
    (variant) => {
      expect(detectSafeRasterImage(webpWithVariant(variant))).toBe(
        "image/webp",
      );
    },
  );
});
