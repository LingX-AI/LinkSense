import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readVerifiedInteractiveAsset } from "../src/modules/applications/interactive-asset-integrity.js";

describe("immutable interactive application assets", () => {
  it("returns the exact bytes only after verifying size and SHA-256", async () => {
    const bytes = Buffer.from("<main>Report</main>");
    const asset = { objectKey: "package/index.html", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    const store = { get: async () => Readable.from(bytes) };
    await expect(readVerifiedInteractiveAsset(store, asset)).resolves.toEqual(bytes);
    await expect(readVerifiedInteractiveAsset(store, { ...asset, byteSize: bytes.length + 1 })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    await expect(readVerifiedInteractiveAsset(store, { ...asset, sha256: "a".repeat(64) })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
});
