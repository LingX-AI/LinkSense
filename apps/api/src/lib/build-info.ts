import { readFileSync } from "node:fs";
import { buildInfoSchema } from "@linksense/shared";
import type { AppConfig } from "../config.js";

// Read the identity baked into the image, never an operator-supplied runtime
// version that could incorrectly label two different images as the same build.
export function readRuntimeBuildId(
  environment: AppConfig["nodeEnv"],
  metadataUrl: URL = new URL("../build-info.json", import.meta.url),
): string | null {
  if (environment !== "production") return null;
  return buildInfoSchema.parse(JSON.parse(readFileSync(metadataUrl, "utf8"))).build_id;
}
