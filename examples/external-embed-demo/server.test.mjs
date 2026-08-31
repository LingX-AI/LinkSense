import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import {
  createExternalEmbedDemoServer,
  resolveDemoConfig,
} from "./server.mjs";

test("normalizes the embed locale to the two supported values", () => {
  assert.equal(resolveDemoConfig({ LINKSENSE_LOCALE: "en-US" }).locale, "en-US");
  assert.equal(resolveDemoConfig({ LINKSENSE_LOCALE: "fr-FR" }).locale, "zh-CN");
  assert.equal(resolveDemoConfig({}).locale, "zh-CN");
});

test("puts the initial locale in the iframe URL and uses a dedicated locale message", async () => {
  const server = createExternalEmbedDemoServer({
    env: {
      LINKSENSE_BASE_URL: "http://localhost:5173",
      LINKSENSE_APP_ID: "lsa_external_demo_app_id",
      LINKSENSE_APP_SECRET:
        "lss_external_demo_secret_with_sufficient_entropy",
      LINKSENSE_LOCALE: "en-US",
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const config = await fetch(
      `http://127.0.0.1:${address.port}/api/config?mode=public`,
    ).then((response) => response.json());
    const overriddenConfig = await fetch(
      `http://127.0.0.1:${address.port}/api/config?mode=public&locale=zh-CN`,
    ).then((response) => response.json());
    const script = await fetch(
      `http://127.0.0.1:${address.port}/demo.js`,
    ).then((response) => response.text());
    assert.equal(new URL(config.iframe_url).searchParams.get("locale"), "en-US");
    assert.equal(
      new URL(overriddenConfig.iframe_url).searchParams.get("locale"),
      "zh-CN",
    );
    assert.match(script, /type: "linksense:locale"/u);
    assert.doesNotMatch(script, /locale: config\.locale/u);
    assert.doesNotMatch(script, /type: "linksense:context"/u);
  } finally {
    server.close();
    await once(server, "close");
  }
});
