import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { chromeUserAgent, generateUserAgent } from "../deploy/runtime/browser/generate-user-agent.mjs";

test("Chrome UA preserves the native platform and version", () => {
  for (const platform of ["X11; Linux x86_64", "X11; Linux aarch64", "Macintosh; Intel Mac OS X 10_15_7"]) {
    for (const version of ["151.0.0.0", "152.0.8000.12"]) {
      const native = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/${version} Safari/537.36`;
      assert.equal(chromeUserAgent(native), native.replace("HeadlessChrome/", "Chrome/"));
      assert.equal(chromeUserAgent(chromeUserAgent(native)), chromeUserAgent(native));
    }
  }
  for (const invalid of [null, "", "Chrome/151", "Mozilla/5.0\nChrome/151.0.0.0 Safari/537.36"]) {
    assert.throws(() => chromeUserAgent(invalid), /Invalid native Chromium/);
  }
});

test("runtime UA generation reads the installed browser and closes it on success or failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-ua-"));
  const native = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36";
  let closed = 0;
  const chromium = {
    async launch(options) {
      assert.equal(options.channel, "chromium");
      return {
        async newPage() { return { async evaluate() { return native; } }; },
        async close() { closed += 1; },
      };
    },
  };
  try {
    const destination = path.join(root, "user-agent.json");
    await generateUserAgent(chromium, destination);
    assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), {
      userAgent: chromeUserAgent(native),
    });
    assert.equal(closed, 1);
    await assert.rejects(generateUserAgent(chromium, path.join(root, "missing", "ua.json")));
    assert.equal(closed, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
