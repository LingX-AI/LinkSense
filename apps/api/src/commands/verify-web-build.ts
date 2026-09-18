import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildInfoSchema } from "@linksense/shared";
import { readRuntimeBuildId } from "../lib/build-info.js";

export async function verifyWebBuild(
  apiBuildId: string,
  manifestUrl: string,
  fetchManifest: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchManifest(manifestUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Web build metadata is unavailable");
  const payload: unknown = await response.json();
  if (buildInfoSchema.parse(payload).build_id !== apiBuildId) {
    throw new Error("Web and API build identities do not match");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const manifestUrl = process.argv[2];
  const buildId = readRuntimeBuildId("production");
  if (!manifestUrl || !buildId) throw new Error("A Web build manifest URL is required");
  verifyWebBuild(buildId, manifestUrl).catch(() => {
    process.stderr.write("Application build verification failed. Keep maintenance enabled and deploy matching Web/API images.\n");
    process.exitCode = 1;
  });
}
