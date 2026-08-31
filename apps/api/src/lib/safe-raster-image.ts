export type SafeRasterImageMimeType =
  "image/gif" | "image/jpeg" | "image/png" | "image/webp";

export type SafeSiteIconMimeType = SafeRasterImageMimeType | "image/x-icon";

export function detectSafeRasterImage(
  bytes: Buffer,
  maxDimension = 8_192,
): SafeRasterImageMimeType | null {
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const validHeader =
      bytes.readUInt32BE(8) === 13 &&
      bytes.subarray(12, 16).toString("ascii") === "IHDR";
    return validHeader &&
      validImageDimensions(
        bytes.readUInt32BE(16),
        bytes.readUInt32BE(20),
        maxDimension,
      )
      ? "image/png"
      : null;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  ) {
    return validJpegDimensions(bytes, maxDimension) ? "image/jpeg" : null;
  }
  if (
    bytes.length >= 10 &&
    ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
  ) {
    return validImageDimensions(
      bytes.readUInt16LE(6),
      bytes.readUInt16LE(8),
      maxDimension,
    )
      ? "image/gif"
      : null;
  }
  return detectSafeWebp(bytes, maxDimension);
}

export function detectSafeSiteIcon(bytes: Buffer): SafeSiteIconMimeType | null {
  return (
    detectSafeRasterImage(bytes) ?? (isSafeIcon(bytes) ? "image/x-icon" : null)
  );
}

function detectSafeWebp(
  bytes: Buffer,
  maxDimension: number,
): "image/webp" | null {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }

  const variant = bytes.subarray(12, 16).toString("ascii");
  if (variant === "VP8X" && bytes.length >= 30) {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return validImageDimensions(width, height, maxDimension)
      ? "image/webp"
      : null;
  }
  if (
    variant === "VP8 " &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    const width = bytes.readUInt16LE(26) & 0x3fff;
    const height = bytes.readUInt16LE(28) & 0x3fff;
    return validImageDimensions(width, height, maxDimension)
      ? "image/webp"
      : null;
  }
  if (variant === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const dimensions = bytes.readUInt32LE(21);
    const width = 1 + (dimensions & 0x3fff);
    const height = 1 + ((dimensions >>> 14) & 0x3fff);
    return validImageDimensions(width, height, maxDimension)
      ? "image/webp"
      : null;
  }
  return null;
}

function isSafeIcon(bytes: Buffer): boolean {
  if (bytes.length < 22) return false;
  if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    return false;
  }
  const count = bytes.readUInt16LE(4);
  if (count === 0 || count > 64 || bytes.length < 6 + count * 16) return false;

  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = bytes[offset] === 0 ? 256 : bytes[offset]!;
    const height = bytes[offset + 1] === 0 ? 256 : bytes[offset + 1]!;
    const size = bytes.readUInt32LE(offset + 8);
    const imageOffset = bytes.readUInt32LE(offset + 12);
    if (
      !validImageDimensions(width, height) ||
      size === 0 ||
      imageOffset < 6 + count * 16 ||
      imageOffset > bytes.length ||
      size > bytes.length - imageOffset
    ) {
      return false;
    }
    const image = bytes.subarray(imageOffset, imageOffset + size);
    if (detectSafeRasterImage(image) === null && !isPlausibleIconDib(image)) {
      return false;
    }
  }
  return true;
}

function isPlausibleIconDib(bytes: Buffer): boolean {
  if (bytes.length < 40 || bytes.readUInt32LE(0) < 40) return false;
  const width = bytes.readInt32LE(4);
  const height = bytes.readInt32LE(8);
  const planes = bytes.readUInt16LE(12);
  const bitsPerPixel = bytes.readUInt16LE(14);
  const compression = bytes.readUInt32LE(16);
  return (
    width > 0 &&
    width <= 8_192 &&
    height > 0 &&
    height <= 16_384 &&
    planes === 1 &&
    [1, 4, 8, 16, 24, 32].includes(bitsPerPixel) &&
    [0, 3, 6].includes(compression)
  );
}

function validImageDimensions(
  width: number,
  height: number,
  maxDimension = 8_192,
): boolean {
  return (
    width > 0 && height > 0 && width <= maxDimension && height <= maxDimension
  );
}

function validJpegDimensions(bytes: Buffer, maxDimension: number): boolean {
  let offset = 2;
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return false;
    offset += 2;
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd9)
    ) {
      continue;
    }
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (length < 7) return false;
      return validImageDimensions(
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
        maxDimension,
      );
    }
    offset += length;
  }
  return false;
}
