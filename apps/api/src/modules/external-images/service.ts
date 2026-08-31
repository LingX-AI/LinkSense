import type { promises as dns } from "node:dns";

import { AppError } from "../../lib/errors.js";
import {
  fetchPublicHttpResource,
  type HttpProtocol,
} from "../../lib/safe-http-fetch.js";
import {
  detectSafeRasterImage,
  type SafeRasterImageMimeType,
} from "../../lib/safe-raster-image.js";

const EXTERNAL_IMAGE_ACCEPT =
  "image/png, image/jpeg, image/gif, image/webp, image/*;q=0.8";
const EXTERNAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const EXTERNAL_IMAGE_REQUEST_TIMEOUT_MS = 8_000;
const EXTERNAL_IMAGE_ALLOWED_PROTOCOLS: readonly HttpProtocol[] = [
  "http:",
  "https:",
];

const MIME_TYPE_EXTENSIONS: Record<SafeRasterImageMimeType, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ExternalImageDownload = {
  data: Buffer;
  filename: string;
  mimeType: SafeRasterImageMimeType;
  sizeBytes: number;
}

export type ExternalImageServiceOptions = {
  fetcher?: typeof fetch;
  lookup?: typeof dns.lookup;
  allowBenchmarkProxyAddresses?: boolean;
  maxBytes?: number;
}

export class ExternalImageService {
  readonly #fetcher: typeof fetch | undefined;
  readonly #lookup: typeof dns.lookup | undefined;
  readonly #allowBenchmarkProxyAddresses: boolean;
  readonly #maxBytes: number;

  constructor(options: ExternalImageServiceOptions = {}) {
    this.#fetcher = options.fetcher;
    this.#lookup = options.lookup;
    this.#allowBenchmarkProxyAddresses =
      options.allowBenchmarkProxyAddresses ?? false;
    this.#maxBytes = options.maxBytes ?? EXTERNAL_IMAGE_MAX_BYTES;
  }

  async download(source: string): Promise<ExternalImageDownload> {
    const url = parseExternalImageUrl(source);
    if (!url) throw new AppError("EXTERNAL_IMAGE_DOWNLOAD_FAILED");

    const downloaded = await fetchPublicHttpResource(url, {
      byteLimit: this.#maxBytes,
      redirectCount: 3,
      requestTimeoutMs: EXTERNAL_IMAGE_REQUEST_TIMEOUT_MS,
      accept: EXTERNAL_IMAGE_ACCEPT,
      userAgent: "LinkSense-External-Image-Download/1.0",
      errorCode: "EXTERNAL_IMAGE_DOWNLOAD_FAILED",
      allowedProtocols: EXTERNAL_IMAGE_ALLOWED_PROTOCOLS,
      allowBenchmarkProxyAddresses: this.#allowBenchmarkProxyAddresses,
      ...(this.#fetcher === undefined ? {} : { fetcher: this.#fetcher }),
      ...(this.#lookup === undefined ? {} : { lookup: this.#lookup }),
    });
    const mimeType = detectSafeRasterImage(downloaded.bytes);
    if (!mimeType) throw new AppError("EXTERNAL_IMAGE_DOWNLOAD_FAILED");

    return {
      data: downloaded.bytes,
      filename: filenameFromUrl(downloaded.finalUrl, mimeType),
      mimeType,
      sizeBytes: downloaded.bytes.byteLength,
    };
  }
}

function parseExternalImageUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (!EXTERNAL_IMAGE_ALLOWED_PROTOCOLS.includes(url.protocol as HttpProtocol)) {
      return null;
    }
    if (url.username !== "" || url.password !== "" || url.origin === "null") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function filenameFromUrl(url: URL, mimeType: SafeRasterImageMimeType): string {
  const extension = MIME_TYPE_EXTENSIONS[mimeType];
  const rawName = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const decodedName = safeDecodeURIComponent(rawName)
    .replace(/[\\/]/gu, "_")
    .trim()
    .slice(0, 260);
  const baseName = decodedName || "image";
  return /\.(?:gif|jpe?g|png|webp)$/iu.test(baseName)
    ? baseName
    : `${baseName}.${extension}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
