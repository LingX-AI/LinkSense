import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { createSecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";
import test, { after, before } from "node:test";
import { assertDevelopmentHttp2 } from "./dev-http2.mjs";
import { createDevelopmentTlsFixture } from "./fixtures/dev-tls-fixture.mjs";

let fixture;
let credentials;
let ca;
before(() => {
  fixture = createDevelopmentTlsFixture();
  credentials = { key: readFileSync(resolve(fixture.directory, "key.pem")), cert: readFileSync(resolve(fixture.directory, "cert.pem")) };
  ca = readFileSync(resolve(fixture.root, "rootCA.pem"));
});
after(() => rmSync(fixture.root, { recursive: true, force: true }));

async function listen(context, server) {
  server.on("secureConnection", (socket) => context.after(() => socket.destroy()));
  server.on("session", (session) => {
    session.on("error", () => {});
    context.after(() => session.destroy());
  });
  context.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `https://127.0.0.1:${server.address().port}`;
}

test("the probe verifies the trusted certificate and negotiated h2 protocol", async (context) => {
  const requests = [];
  const origin = await listen(context, createSecureServer(credentials, (request, response) => {
    requests.push([request.httpVersion, request.method, request.url]);
    response.end();
  }));
  await assertDevelopmentHttp2(origin, { ca });
  assert.deepEqual(requests, [["2.0", "HEAD", "/"]]);
});

test("an HTTPS server that only supports HTTP1 cannot pass the HTTP2 readiness check", async (context) => {
  const origin = await listen(context, createHttpsServer(credentials, (_request, response) => response.end()));
  await assert.rejects(assertDevelopmentHttp2(origin, { ca }));
});

test("the probe rejects an untrusted certificate rather than disabling TLS verification", async (context) => {
  const origin = await listen(context, createSecureServer(credentials, (_request, response) => response.end()));
  await assert.rejects(assertDevelopmentHttp2(origin), /certificate|issuer/iu);
});

test("HTTP2 alone is insufficient when the Web entry returns an error", async (context) => {
  const origin = await listen(context, createSecureServer(credentials, (_request, response) => {
    response.writeHead(502);
    response.end();
  }));
  await assert.rejects(assertDevelopmentHttp2(origin, { ca }), /HTTP 502/u);
});

test("a stalled HTTP2 response times out and closes its session", async (context) => {
  const origin = await listen(context, createSecureServer(credentials, () => {}));
  await assert.rejects(assertDevelopmentHttp2(origin, { ca, timeoutMs: 100 }), /timed out/u);
});

test("cancellation stops an active HTTP2 probe without waiting for its timeout", async (context) => {
  const controller = new AbortController();
  const origin = await listen(context, createSecureServer(credentials, () => controller.abort(new Error("cancelled"))));
  await assert.rejects(assertDevelopmentHttp2(origin, { ca, signal: controller.signal }), /cancelled/u);
});

test("HTTP origins and already-cancelled probes are rejected before sending a request", async () => {
  assert.throws(() => assertDevelopmentHttp2("http://localhost:18172"), /HTTPS origin/u);
  await assert.rejects(assertDevelopmentHttp2("https://localhost:18173", {
    signal: AbortSignal.abort(new Error("already cancelled")),
  }), /already cancelled/u);
});
