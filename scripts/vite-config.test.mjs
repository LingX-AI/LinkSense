import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const webRoot = join(repository, "apps/web");
const requireWeb = createRequire(join(webRoot, "package.json"));
const { loadConfigFromFile } = await import(pathToFileURL(requireWeb.resolve("vite")).href);

test("Vite loads development and build configuration without compiled shared output", async () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-vite-config-"));
  const fixtureWeb = join(root, "apps/web");
  const previousDirectory = process.cwd();
  try {
    // Mirror the source-only shared package in Docker development without
    // deleting or changing any build output in the developer's checkout.
    for (const file of [
      "apps/web/package.json", "apps/web/vite.config.ts",
      "apps/web/src/test/shared-dom-files.ts",
      "packages/shared/package.json", "packages/shared/src/html-preview-shell-document.ts",
      "scripts/application-build.mjs", "scripts/source-fingerprint.mjs",
    ]) {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repository, file), target);
    }
    const manifest = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8"));
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const target = join(fixtureWeb, "node_modules", name);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(name === "@linksense/shared" ? join(root, "packages/shared") : join(webRoot, "node_modules", name), target, "dir");
    }
    assert.equal(existsSync(join(root, "packages/shared/dist")), false);
    // Match the web CLI working directory used by plugins to resolve dependencies.
    process.chdir(fixtureWeb);
    for (const command of ["serve", "build"]) {
      const loaded = await loadConfigFromFile({ command, mode: command === "serve" ? "development" : "production" }, join(fixtureWeb, "vite.config.ts"), fixtureWeb, "silent");
      assert(loaded, `${command} configuration must load without a shared build`);
      const shell = loaded.config.plugins.flat().find(plugin => plugin?.name === "linksense-html-preview-shell");
      assert(shell, "HTML preview shell must remain available");
      let emitted;
      shell.generateBundle.call({ emitFile: asset => { emitted = asset; } });
      assert.equal(emitted.fileName, "assistant-html-preview-shell.html");
      assert.match(emitted.source, /linksense:assistant-html-preview:shell-ready/u);
      let middleware;
      shell.configureServer({ middlewares: { use: handler => { middleware = handler; } } });
      let body;
      middleware({ url: "/assistant-html-preview-shell.html?previewId=test" }, { setHeader() {}, end(value) { body = value; } }, () => assert.fail("Preview shell must be served"));
      assert.equal(body, emitted.source, "Development and production must serve the same shell");
    }
  } finally {
    process.chdir(previousDirectory);
    rmSync(root, { recursive: true, force: true });
  }
});
