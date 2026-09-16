import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import test from "node:test";
import { developmentSourcePaths, synchronizeDevelopmentSource } from "./dev-source.mjs";

test("source synchronization mirrors offline edits and deletions while preserving the image Prisma client", () => {
  const root = mkdtempSync(resolve(tmpdir(), "linksense-source-"));
  const sourceRoot = resolve(root, "source");
  const targetRoot = resolve(root, "container");
  const write = (base, file, value) => {
    const path = resolve(base, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  try {
    write(sourceRoot, "apps/api/src/index.ts", "new");
    write(sourceRoot, "apps/api/src/generated/client.ts", "host client");
    write(sourceRoot, "apps/api/tsconfig.json", "{}");
    write(sourceRoot, "packages/shared/src/index.ts", "export {}");
    write(sourceRoot, "apps/docs/docs/channels.md", "current Chinese docs");
    write(sourceRoot, "apps/docs/i18n/en-US/docusaurus-plugin-content-docs/current/channels.md", "current English docs");
    write(targetRoot, "apps/api/src/index.ts", "old");
    write(targetRoot, "apps/api/src/removed.ts", "old");
    write(targetRoot, "apps/api/src/generated/client.ts", "Linux client");
    write(targetRoot, "apps/docs/docs/removed.md", "obsolete docs");
    const preserved = [
      "apps/api/package.json", "apps/api/node_modules/local-package/index.js",
      "apps/web/src/index.ts", "apps/runner/src/index.ts", "packages/shared/package.json",
      "apps/docs/i18n/en-US/docusaurus-theme-classic/navbar.json", "prisma/schema.prisma",
    ];
    for (const file of preserved) write(targetRoot, file, "image-owned file");
    assert.deepEqual(synchronizeDevelopmentSource("api", { sourceRoot, targetRoot }), { changed: true });
    assert.equal(readFileSync(resolve(targetRoot, "apps/api/src/index.ts"), "utf8"), "new");
    assert.throws(() => readFileSync(resolve(targetRoot, "apps/api/src/removed.ts")), { code: "ENOENT" });
    assert.equal(readFileSync(resolve(targetRoot, "apps/api/src/generated/client.ts"), "utf8"), "Linux client");
    assert.equal(readFileSync(resolve(targetRoot, "apps/docs/docs/channels.md"), "utf8"), "current Chinese docs");
    assert.equal(readFileSync(resolve(targetRoot, "apps/docs/i18n/en-US/docusaurus-plugin-content-docs/current/channels.md"), "utf8"), "current English docs");
    assert.throws(() => readFileSync(resolve(targetRoot, "apps/docs/docs/removed.md")), { code: "ENOENT" });
    assert.deepEqual(synchronizeDevelopmentSource("api", { sourceRoot, targetRoot }), { changed: false });
    for (const file of preserved) {
      assert.equal(readFileSync(resolve(targetRoot, file), "utf8"), "image-owned file");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each service synchronizes all source roots through one bounded Docker transport", () => {
  for (const service of Object.keys(developmentSourcePaths)) {
    const calls = [];
    const result = synchronizeDevelopmentSource(service, {
      sourceRoot: "/host/source with spaces", targetRoot: "/workspace", container: "abcdef123456",
      execute: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.deepEqual(result, { changed: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "rsync");
    assert.ok(calls[0].args.includes("--rsh=docker exec -i"));
    assert.ok(calls[0].args.includes("--exclude=*"));
    assert.equal(calls[0].args.at(-2), "./");
    assert.equal(calls[0].args.at(-1), "abcdef123456:/workspace/");
    assert.equal(calls[0].options.timeout, 30_000);
    assert.equal(calls[0].options.cwd, "/host/source with spaces");
    for (const path of developmentSourcePaths[service]) {
      assert.ok(calls[0].args.some((arg) => arg === `--include=/${path}` || arg === `--include=/${path}/***`));
    }
  }
});

test("source synchronization rejects unknown services and failed transfers", () => {
  assert.throws(() => synchronizeDevelopmentSource("../elsewhere"), /Unknown/u);
  const root = mkdtempSync(resolve(tmpdir(), "linksense-source-failure-"));
  try {
    assert.throws(() => synchronizeDevelopmentSource("web", {
      sourceRoot: root, targetRoot: root,
      execute: () => ({ status: 23, stdout: "", stderr: "private path" }),
    }), /^Error: Development source synchronization failed for web$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(Object.values(developmentSourcePaths).flat().every((path) => !path.includes("node_modules")));
});

test("timestamp-only rsync reports do not restart unchanged services", () => {
  for (const [stdout, changed] of [
    [".f..T.... apps/api/src/index.ts\n", false],
    [".f..t...... apps/api/tsconfig.json\n.d..t...... apps/api/src/\n", false],
    [">fcsT.... apps/api/src/index.ts\n", true],
    ["cd+++++++ apps/api/src/new/\n", true],
    ["cL+++++++ apps/api/src/link.ts\n", true],
    ["*deleting apps/api/src/removed.ts\n", true],
  ]) {
    assert.deepEqual(synchronizeDevelopmentSource("api", {
      container: "abcdef123456",
      execute: () => ({ status: 0, stdout, stderr: "" }),
    }), { changed });
  }
});

test("viewer-generated metadata stays in Linux without causing an unchanged Web restart", () => {
  const root = mkdtempSync(resolve(tmpdir(), "linksense-viewer-source-"));
  const sourceRoot = resolve(root, "source");
  const targetRoot = resolve(root, "container");
  try {
    for (const base of [sourceRoot, targetRoot]) {
      for (const path of developmentSourcePaths.web) {
        if (path.endsWith(".ts") || path.endsWith(".html")) {
          mkdirSync(dirname(resolve(base, path)), { recursive: true });
          writeFileSync(resolve(base, path), "unchanged");
        } else mkdirSync(resolve(base, path), { recursive: true });
      }
    }
    writeFileSync(resolve(sourceRoot, "apps/web/public/flyfish-viewer-assets.json"), "host metadata");
    const manifest = resolve(targetRoot, "apps/web/public/flyfish-viewer-assets.json");
    writeFileSync(manifest, "Linux metadata");
    assert.deepEqual(synchronizeDevelopmentSource("web", { sourceRoot, targetRoot }), { changed: false });
    assert.equal(readFileSync(manifest, "utf8"), "Linux metadata");
    writeFileSync(resolve(sourceRoot, "apps/web/public/logo.svg"), "new asset");
    assert.deepEqual(synchronizeDevelopmentSource("web", { sourceRoot, targetRoot }), { changed: true });
    assert.equal(readFileSync(resolve(targetRoot, "apps/web/public/logo.svg"), "utf8"), "new asset");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
