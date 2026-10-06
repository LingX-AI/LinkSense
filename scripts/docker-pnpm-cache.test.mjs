import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const [file, expectedInstalls, user] of [
  ["Dockerfile.dev", 1, "node"],
  ["Dockerfile.api", 2, "root"],
  ["Dockerfile.runner", 1, "root"],
  ["Dockerfile.web", 1, "root"],
  ["deploy/baselines/Dockerfile.runtime", 3, "root"],
]) {
  test(`${file} reuses pnpm downloads after dependency layers change`, async () => {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const instructions = source.replace(/\\\r?\n/g, " ").split(/\r?\n/);
    const installs = instructions.filter((line) => line.startsWith("RUN ") && line.includes("pnpm install"));
    assert.equal(installs.length, expectedInstalls);
    for (const install of installs) {
      // Content-addressed downloads survive manifest changes, but native
      // artifacts and writable files must not cross architectures or users.
      assert.ok(install.includes(`id=linksense-pnpm-node24-\${TARGETARCH}\${TARGETVARIANT}-${user}`));
      assert.match(install, /--mount=type=cache,[^ ]*target=\/pnpm\/store/);
      assert.match(install, /sharing=locked/);
      assert.match(install, /--store-dir=\/pnpm\/store/);
      assert.match(install, /--frozen-lockfile/);
      assert.match(install, /--prefer-offline/);
      // Installed files must remain usable when the cache mount is absent.
      assert.match(install, /--package-import-method=copy/);
      assert.doesNotMatch(install, /pnpm store prune/);
      assert.doesNotMatch(install, /install-browser|\/smoke\.mjs/);
      if (user === "node") {
        assert.match(install, /uid=1000,gid=1000/);
      }
    }
    assert.match(source, /^ARG TARGETARCH$/m);
    assert.match(source, /^ARG TARGETVARIANT$/m);
    for (const deploy of instructions.filter((line) => line.startsWith("RUN ") && line.includes(" deploy "))) {
      assert.ok(deploy.includes("id=linksense-pnpm-node24-${TARGETARCH}${TARGETVARIANT}-root"));
      assert.match(deploy, /--mount=type=cache,[^ ]*target=\/pnpm\/store/);
      assert.match(deploy, /--mount=type=cache,[^ ]*target=\/pnpm\/metadata/);
      assert.match(deploy, /--cache-dir=\/pnpm\/metadata/);
      assert.match(deploy, /--prefer-offline/);
    }
  });
}

test("browser binaries survive an interrupted baseline build and are copied into the worker environment", async () => {
  const source = await readFile(new URL("../deploy/baselines/Dockerfile.runtime", import.meta.url), "utf8");
  const browserStage = source.split("FROM toolchain AS browser-runtime-build")[1].split("FROM node-runtime AS node")[0];
  const install = browserStage.replace(/\\\r?\n/g, " ").split(/\r?\n/).find((line) => line.startsWith("RUN ") && line.includes("install-browser"));
  assert.match(install, /--mount=type=cache,id=linksense-playwright-\$\{TARGETARCH\}\$\{TARGETVARIANT\},target=\/var\/cache\/linksense-playwright,sharing=locked/);
  assert.match(install, /export PLAYWRIGHT_BROWSERS_PATH=\/var\/cache\/linksense-playwright/);
  assert.match(install, /cp -a "\$\{PLAYWRIGHT_BROWSERS_PATH\}\/\." \/opt\/linksense\/runtime\/browser-browsers\//);
  assert.doesNotMatch(install, /target=\/pnpm\/store/);
  const application = await readFile(new URL("../Dockerfile.runner", import.meta.url), "utf8");
  assert.match(application, /FROM \$\{BASELINE_WORKER_IMAGE\} AS worker/u);
  assert.doesNotMatch(application, /install-browser|browser-runtime-cache/u);
});
