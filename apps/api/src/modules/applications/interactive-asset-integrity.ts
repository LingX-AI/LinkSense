import { createHash } from "node:crypto";
import { buffer } from "node:stream/consumers";
import { AppError } from "../../lib/errors.js";
import type { InteractiveApplicationAssetStore } from "./service.js";

export async function readVerifiedInteractiveAsset(
  store: Pick<InteractiveApplicationAssetStore, "get">,
  asset: { objectKey: string; byteSize: number; sha256: string },
): Promise<Buffer> {
  const bytes = await buffer(await store.get(asset.objectKey));
  if (bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  }
  return bytes;
}
