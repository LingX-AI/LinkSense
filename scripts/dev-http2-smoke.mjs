import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { connect } from "node:http2";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { assertDevelopmentHttp2 } from "./dev-http2.mjs";
import { createDevelopmentTlsFixture } from "./fixtures/dev-tls-fixture.mjs";

// Explicit Docker integration check, separate from machine-independent unit
// tests. Reuses the development image and the exact committed Nginx config.
const applicationImage = process.argv[2] ?? "linksense-api-dev:local";
const fixture = createDevelopmentTlsFixture();
const ca = readFileSync(resolve(fixture.root, "rootCA.pem"));
const network = `linksense-h2-smoke-${randomUUID()}`;
const web = `${network}-web`;
const gateway = `${network}-gateway`;
const containers = [];
let networkCreated = false;
let session;
let socket;
const streams = [];
const docker = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const port = (container, internal) => {
  const result = docker(["port", container, `${internal}/tcp`]);
  const match = /^127\.0\.0\.1:(\d+)$/u.exec(result);
  assert.ok(match, "expected a dynamically allocated loopback port");
  return match[1];
};
async function ready(check) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { await check(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}
async function h2Json(origin) {
  const request = session.request({ ":path": "/api", origin });
  const headers = once(request, "response", { signal: AbortSignal.timeout(5_000) });
  request.setEncoding("utf8");
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  const ended = once(request, "end", { signal: AbortSignal.timeout(5_000) });
  request.end();
  assert.equal((await headers)[0][":status"], 200);
  await ended;
  return JSON.parse(body);
}

try {
  docker(["network", "create", network]);
  networkCreated = true;
  docker(["run", "-d", "--rm", "--name", web, "--network", network, "--network-alias", "web",
    "-p", "127.0.0.1::18173", "--mount", `type=bind,src=${resolve("scripts/fixtures/dev-http2-upstream.mjs")},dst=/workspace/scripts/dev-http2-upstream.mjs,readonly`,
    "--entrypoint", "node", applicationImage, "/workspace/scripts/dev-http2-upstream.mjs"]);
  containers.push(web);
  docker(["run", "-d", "--rm", "--name", gateway, "--network", network, "-p", "127.0.0.1::443",
    "--mount", `type=bind,src=${resolve("deploy/development/nginx")},dst=/etc/nginx/conf.d,readonly`,
    "--mount", `type=bind,src=${fixture.directory},dst=/run/linksense-dev-tls,readonly`,
    "nginx:1.28-alpine"]);
  containers.push(gateway);
  const httpOrigin = `http://127.0.0.1:${port(web, 18173)}`;
  const httpsOrigin = `https://127.0.0.1:${port(gateway, 443)}`;
  await ready(async () => {
    const response = await fetch(httpOrigin, { signal: AbortSignal.timeout(1_000), redirect: "error" });
    assert.equal(response.status, 200);
    await response.body.cancel();
  });
  await ready(() => assertDevelopmentHttp2(httpsOrigin, { ca, timeoutMs: 1_000 }));
  session = connect(httpsOrigin, { ca });
  await once(session, "connect");
  assert.equal(session.alpnProtocol, "h2");

  // The first event must arrive before any stream ends (detect buffering).
  await Promise.all(Array.from({ length: 8 }, async (_value, index) => {
    const stream = session.request({ ":path": `/events?task=${index}` });
    streams.push(stream);
    const first = once(stream, "data", { signal: AbortSignal.timeout(5_000) });
    stream.end();
    assert.match(String((await first)[0]), /data: ready/u);
  }));
  const api = await h2Json(httpsOrigin);
  assert.equal(api.activeStreams, 8);
  assert.equal(api.host, new URL(httpsOrigin).host);
  assert.equal(api.origin, httpsOrigin);
  assert.equal(api.protocol, "https");
  assert.ok(streams.every((stream) => !stream.closed));
  const httpResponse = await fetch(`${httpOrigin}/api`, { signal: AbortSignal.timeout(5_000), redirect: "error" });
  assert.equal(httpResponse.status, 200);
  assert.equal((await httpResponse.json()).activeStreams, 8);

  socket = new WebSocket(`${httpsOrigin.replace("https:", "wss:")}/hmr`, { ca, handshakeTimeout: 5_000 });
  await once(socket, "open");
  const echo = once(socket, "message", { signal: AbortSignal.timeout(5_000) });
  socket.send("hot-update");
  assert.equal(String((await echo)[0]), "hot-update");
  console.log("PASS: simultaneous HTTP + trusted HTTPS/h2; eight unbuffered SSE streams on one h2 session; HTTP/HTTPS API requests; WSS upgrade and messages.");
} finally {
  socket?.terminate();
  for (const stream of streams) stream.close();
  session?.destroy();
  for (const container of containers.reverse()) docker(["rm", "-f", container]);
  if (networkCreated) docker(["network", "rm", network]);
  rmSync(fixture.root, { recursive: true, force: true });
}
