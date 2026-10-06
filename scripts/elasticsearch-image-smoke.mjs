import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const image = process.argv[2];
if (!image || !/^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u.test(image)) throw new Error("An immutable Elasticsearch image is required");
const name = `linksense-elasticsearch-smoke-${randomUUID()}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 }).trim();
let id;
try {
  id = docker("run", "--detach", "--rm", "--name", name, "--label", "org.linksense.release-smoke=elasticsearch", "--publish", "127.0.0.1::9200", "--env", "discovery.type=single-node", "--env", "xpack.security.enabled=false", "--env", "node.store.allow_mmap=false", "--env", "ES_JAVA_OPTS=-Xms256m -Xmx256m", "--memory", "1536m", image);
  assert.match(id, /^[0-9a-f]{64}$/u);
  const port = docker("port", id, "9200/tcp").split(":").at(-1);
  assert.match(port, /^\d+$/u);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${base}/_cluster/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && ["yellow", "green"].includes((await response.json()).status)) { ready = true; break; }
    } catch { /* The server is still starting. */ }
    await setTimeout(1_000);
  }
  assert.ok(ready, "Elasticsearch must start with the patched embedded libraries");
  const indexed = await fetch(`${base}/release-smoke/_doc/1?refresh=true`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "安全更新 security-check", quote: '"quoted"', nested: { enabled: true } }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(indexed.ok, "Patched Jackson must parse indexed documents");
  const result = await fetch(`${base}/release-smoke/_search`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: { match: { text: "security-check" } } }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(result.ok);
  assert.equal((await result.json()).hits.hits[0]._source.quote, '"quoted"');
  console.log("Patched Elasticsearch starts, indexes and searches successfully.");
} catch (error) {
  if (id) console.error(docker("logs", id));
  throw error;
} finally {
  if (id) {
    assert.equal(docker("inspect", id, "--format", '{{index .Config.Labels "org.linksense.release-smoke"}}'), "elasticsearch");
    docker("rm", "--force", "--volumes", id);
  }
}
