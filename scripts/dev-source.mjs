import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Rsync uses Docker exec as its transport. Dependencies and generated Prisma
// code stay in the image; source is synchronized onto the Linux filesystem.
export const developmentSourcePaths = {
  api: ["apps/api/src", "apps/api/tsconfig.json", "packages/shared/src", "apps/docs/docs", "apps/docs/i18n/en-US/docusaurus-plugin-content-docs/current"],
  runner: ["apps/runner/src", "apps/runner/tsconfig.json", "packages/shared/src"],
  web: ["apps/web/src", "apps/web/public", "apps/web/index.html", "apps/web/vite.config.ts", "packages/shared/src"],
};

export function synchronizeDevelopmentSource(service, options = {}) {
  const paths = developmentSourcePaths[service];
  if (!paths) throw new Error("Unknown development source service");
  const sourceRoot = options.sourceRoot ?? process.cwd();
  const targetRoot = options.targetRoot ?? "/workspace";
  const container = options.container;
  if (container && !/^[a-f0-9]{12,64}$/u.test(container)) throw new Error("Invalid development container ID");
  const execute = options.execute ?? spawnSync;
  let changed = false;
  for (const path of paths) {
    const directory = !path.endsWith(".json") && !path.endsWith(".ts") && !path.endsWith(".html");
    const target = resolve(targetRoot, path);
    if (!container) mkdirSync(directory ? target : dirname(target), { recursive: true });
    const result = execute("rsync", [
      ...(container ? ["--rsh=docker exec -i", "--blocking-io"] : []),
      "--recursive", "--links", "--safe-links", "--checksum", "--delete",
      "--itemize-changes", "--omit-dir-times", "--no-perms", "--no-owner", "--no-group",
      // Excludes also protect the receiver from --delete. Prisma is generated
      // in the image and must survive synchronizing apps/api/src.
      ...(path === "apps/api/src" ? ["--exclude=/generated/"] : []),
      // The viewer plugin regenerates this manifest with Linux paths and a
      // timestamp on every Vite start. Host metadata must not trigger a restart.
      ...(path === "apps/web/public" ? ["--exclude=/flyfish-viewer-assets.json"] : []),
      "--exclude=node_modules/", "--exclude=.DS_Store",
      `${resolve(sourceRoot, path)}${directory ? "/" : ""}`,
      `${container ? `${container}:` : ""}${target}${directory ? "/" : ""}`,
    ], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Development source synchronization failed for ${service}`);
    changed ||= Boolean(result.stdout.trim());
  }
  return { changed };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(synchronizeDevelopmentSource(process.argv[2], { container: process.argv[3] })));
}
