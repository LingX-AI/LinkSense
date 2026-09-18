import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sourceFingerprint } from "./source-fingerprint.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Both images fingerprint the same source snapshot, including shared contracts
// and build configuration. Generated Prisma output is platform-dependent.
export const applicationBuildInputs = [
  "apps/api/package.json", "apps/api/src", "apps/api/tsconfig.json", "apps/api/tsconfig.build.json",
  "apps/web/package.json", "apps/web/src", "apps/web/public", "apps/web/index.html",
  "apps/web/vite.config.ts", "apps/web/tsconfig.app.json", "apps/web/tsconfig.node.json",
  "packages/shared/package.json", "packages/shared/src", "packages/shared/tsconfig.json",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
  "prisma/schema.prisma", "prisma/migrations", "patches",
  "Dockerfile.api", "Dockerfile.web", "deploy/nginx",
  "scripts/application-build.mjs", "scripts/source-fingerprint.mjs",
];

export function applicationBuildId(rootDirectory = repositoryRoot, suppliedId = process.env.LINKSENSE_BUILD_ID) {
  if (suppliedId !== undefined) {
    if (!/^[a-f0-9]{64}$/u.test(suppliedId)) throw new Error("Invalid application build identity");
    return suppliedId;
  }
  return sourceFingerprint(rootDirectory, applicationBuildInputs, ["apps/api/src/generated"]);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === "id") {
    process.stdout.write(applicationBuildId(process.argv[3]) + "\n");
  } else if (process.argv[2] === "api") {
    const output = resolve(repositoryRoot, "apps/api/dist/build-info.json");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({ build_id: applicationBuildId() }) + "\n");
  } else {
    throw new Error("Expected application-build.mjs id [source-root] or api");
  }
}
