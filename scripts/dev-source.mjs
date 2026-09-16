import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
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
  if (!container) mkdirSync(targetRoot, { recursive: true });
  const includes = new Set();
  for (const path of paths) {
    const directory = !path.endsWith(".json") && !path.endsWith(".ts") && !path.endsWith(".html");
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      includes.add(`--include=/${segments.slice(0, depth).join("/")}/`);
    }
    includes.add(`--include=/${path}${directory ? "/***" : ""}`);
  }
  const result = execute("rsync", [
    ...(container ? ["--rsh=docker exec -i", "--blocking-io"] : []),
    "--recursive", "--links", "--safe-links", "--checksum", "--delete",
    "--itemize-changes", "--omit-dir-times", "--no-perms", "--no-owner", "--no-group",
    // Filters are anchored at the shared transfer root, and also protect the
    // receiver from deletion. Generated Linux files must remain image-owned.
    "--exclude=/apps/api/src/generated/",
    "--exclude=/apps/web/public/flyfish-viewer-assets.json",
    "--exclude=node_modules/", "--exclude=.DS_Store",
    // Traverse only selected roots. Excluded siblings are also protected from
    // deletion, including dependencies and other applications in the image.
    ...includes, "--exclude=*",
    "./",
    `${container ? `${container}:` : ""}${resolve(targetRoot)}/`,
  ], { cwd: resolve(sourceRoot), encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Development source synchronization failed for ${service}`);
  // macOS openrsync can report .f..T.... for equal contents with different
  // mtimes even without --times. Only transfers, creations and deletions
  // require restarting the service; metadata-only reports do not.
  return { changed: /^(?:[<>ch][fdLDS]|\*deleting\b)/mu.test(result.stdout) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(synchronizeDevelopmentSource(process.argv[2], { container: process.argv[3] })));
}
