import type { LookupAddress } from "node:dns";

import { describe, expect, it, vi } from "vitest";

import { ExternalImageService } from "../src/modules/external-images/service.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const PUBLIC_LOOKUP = vi.fn(
  async (): Promise<LookupAddress[]> => [
    { address: "93.184.216.34", family: 4 },
  ],
) as unknown as typeof import("node:dns").promises.lookup;

describe("ExternalImageService", () => {
  it("downloads a public raster image and derives a safe filename", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(PNG, {
        headers: {
          "content-length": String(PNG.byteLength),
          "content-type": "image/png",
        },
      });
    }) as unknown as typeof fetch;
    const service = new ExternalImageService({
      fetcher,
      lookup: PUBLIC_LOOKUP,
      maxBytes: 1024 * 1024,
    });

    const result = await service.download(
      "https://cdn.example.com/assets/%E6%BC%94%E7%A4%BA",
    );

    expect(result).toEqual({
      data: PNG,
      filename: "演示.png",
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://cdn.example.com/assets/%E6%BC%94%E7%A4%BA"),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
      }),
    );
  });

  it("rejects non-image content even when a remote server labels it as an image", async () => {
    const fetcher = vi.fn(async () => {
      return new Response("not an image", {
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;
    const service = new ExternalImageService({
      fetcher,
      lookup: PUBLIC_LOOKUP,
      maxBytes: 1024 * 1024,
    });

    await expect(
      service.download("https://cdn.example.com/not-image.png"),
    ).rejects.toMatchObject({ code: "EXTERNAL_IMAGE_DOWNLOAD_FAILED" });
  });

  it("rejects non-http image sources before fetching", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const service = new ExternalImageService({
      fetcher,
      lookup: PUBLIC_LOOKUP,
      maxBytes: 1024 * 1024,
    });

    await expect(
      service.download("data:image/png;base64,AAAA"),
    ).rejects.toMatchObject({ code: "EXTERNAL_IMAGE_DOWNLOAD_FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
